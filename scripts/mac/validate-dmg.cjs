const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const semver = require('semver');

const allowedArchitectures = new Set(['arm64', 'x86_64']);
const allowedSignaturePolicies = new Set(['ad-hoc', 'required', 'observe']);
const thinMachOMagic = new Set(['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe']);
const fatMachOMagic = new Map([
  ['cafebabe', 'BE'], ['bebafeca', 'LE'],
  ['cafebabf', 'BE'], ['bfbafeca', 'LE'],
]);
const maximumInventoryDepth = 64;
const maximumInventoryEntries = 20000;
// Apple requires CFBundleShortVersionString to contain exactly three numeric components.
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const devicePattern = /^\/dev\/disk\d+(?:s\d+)*$/;

function defaultExecute(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    input: options.input,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120000,
    killSignal: 'SIGKILL',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function parseCliArguments(args) {
  const names = new Map([
    ['--directory', 'bundleDirectory'],
    ['--version', 'expectedVersion'],
    ['--arch', 'expectedArch'],
    ['--sha256', 'expectedSha256'],
    ['--icon-sha256', 'expectedIconSha256'],
    ['--notices-sha256', 'expectedNoticesSha256'],
    ['--signature', 'signaturePolicy'],
    ['--evidence', 'evidenceFile'],
  ]);
  assert.ok(args.length > 0 && args.length % 2 === 0, 'Expected name/value CLI arguments');
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = names.get(args[index]);
    assert.ok(key, `Unknown argument: ${args[index]}`);
    assert.ok(!(key in options), `Duplicate argument: ${args[index]}`);
    assert.ok(args[index + 1], `Missing value for ${args[index]}`);
    options[key] = args[index + 1];
  }
  assert.ok(options.bundleDirectory, '--directory is required');
  assert.ok(options.evidenceFile, '--evidence is required');
  assert.match(options.expectedVersion || '', versionPattern, '--version must be an Apple short version with three numeric components');
  assert.ok(allowedArchitectures.has(options.expectedArch), '--arch must be arm64 or x86_64');
  options.signaturePolicy ||= 'required';
  assert.ok(allowedSignaturePolicies.has(options.signaturePolicy), '--signature must be ad-hoc, required or observe');
  if (options.expectedSha256) assert.match(options.expectedSha256, /^[0-9a-f]{64}$/, '--sha256 must be a lowercase SHA-256 digest');
  if (options.expectedIconSha256) {
    assert.match(options.expectedIconSha256, /^[0-9a-f]{64}$/, '--icon-sha256 must be a lowercase SHA-256 digest');
  }
  if (options.expectedNoticesSha256) {
    assert.match(options.expectedNoticesSha256, /^[0-9a-f]{64}$/, '--notices-sha256 must be a lowercase SHA-256 digest');
  }
  return options;
}

function formatCommand(command, args) {
  return [command, ...args.map(value => JSON.stringify(value))].join(' ');
}

function commandRunner(dependencies) {
  const execute = dependencies.execute || defaultExecute;
  const writeOutput = dependencies.writeOutput || (value => process.stdout.write(value));
  const writeError = dependencies.writeError || (value => process.stderr.write(value));
  return (command, args, options = {}) => {
    writeOutput(`$ ${formatCommand(command, args)}\n`);
    const result = execute(command, args, options);
    if (result.stdout) writeOutput(result.stdout);
    if (result.stderr) writeError(result.stderr);
    if (result.status !== 0 && !options.allowFailure) {
      throw new Error(`${command} ${args[0] || ''} failed with status ${result.status}`);
    }
    return result;
  };
}

async function sha256(file) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(file);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

async function findSingleDmg(bundleDirectory) {
  const root = path.resolve(bundleDirectory);
  const rootInfo = await fsp.lstat(root);
  assert.ok(rootInfo.isDirectory() && !rootInfo.isSymbolicLink(), 'DMG bundle root must be a real directory');
  const entries = await fsp.readdir(root, { withFileTypes: true });
  const candidates = entries.filter(entry => entry.name.endsWith('.dmg'));
  assert.equal(candidates.length, 1, 'Expected exactly one DMG in the bundle directory');
  assert.ok(candidates[0].isFile() && !candidates[0].isSymbolicLink(), 'DMG must be a regular file');
  return path.join(root, candidates[0].name);
}

function parseJsonOutput(output, label) {
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`${label} did not produce valid JSON: ${error.message}`);
  }
}

function extractPlistXml(output, label) {
  assert.equal(typeof output, 'string', `${label} must be text`);
  const declaration = '<?xml';
  const closingTag = '</plist>';
  const start = output.indexOf(declaration);
  assert.notEqual(start, -1, `${label} has no XML property list`);
  assert.equal(output.indexOf(declaration, start + declaration.length), -1, `${label} has multiple XML property lists`);
  const closingStart = output.indexOf(closingTag, start);
  assert.notEqual(closingStart, -1, `${label} has no complete XML property list`);
  const end = closingStart + closingTag.length;
  assert.equal(output.indexOf(closingTag, end), -1, `${label} has multiple XML property lists`);
  assert.equal(output.slice(end).trim(), '', `${label} has unexpected data after its XML property list`);
  return output.slice(start, end);
}

function appleShortVersion(version) {
  assert.equal(semver.valid(version), version, 'Package version must be strict SemVer');
  const parsed = semver.parse(version);
  return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

async function exactMountedDevice(attachInfo, requestedMountPoint) {
  const entities = attachInfo['system-entities'];
  assert.ok(Array.isArray(entities), 'Attach metadata has no system entities');
  const canonicalRequested = await fsp.realpath(requestedMountPoint);
  const matches = [];
  for (const entity of entities) {
    if (typeof entity?.['mount-point'] !== 'string') continue;
    let canonicalReported;
    try {
      canonicalReported = await fsp.realpath(entity['mount-point']);
    } catch {
      continue;
    }
    if (canonicalReported === canonicalRequested) matches.push(entity);
  }
  assert.equal(matches.length, 1, 'Attach metadata must identify exactly one requested mountpoint');
  const device = matches[0]['dev-entry'];
  assert.match(device || '', devicePattern, 'Attach metadata has no exact mounted device');
  return device;
}

async function requireRealDirectory(directory, label) {
  const info = await fsp.lstat(directory);
  assert.ok(info.isDirectory() && !info.isSymbolicLink(), `${label} must be a real directory`);
}

async function requireExecutable(file) {
  const info = await fsp.lstat(file);
  assert.ok(info.isFile() && !info.isSymbolicLink(), 'Expected RepoDeck executable is not a regular file');
  try {
    await fsp.access(file, fs.constants.X_OK);
  } catch {
    throw new Error('Expected RepoDeck executable is not executable');
  }
}

async function prepareEvidenceDestination(file) {
  assert.equal(typeof file, 'string', 'Evidence file is required');
  assert.ok(file.length > 0, 'Evidence file is required');
  const destination = path.resolve(file);
  await requireRealDirectory(path.dirname(destination), 'Evidence parent');
  try {
    await fsp.lstat(destination);
    throw new Error(`Evidence file already exists: ${destination}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return destination;
}

async function inspectRegularFile(file) {
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  const handle = await fsp.open(file, fs.constants.O_RDONLY | noFollow);
  try {
    const info = await handle.stat();
    assert.ok(info.isFile(), `App inventory entry changed while being inspected: ${file}`);
    const header = Buffer.alloc(8);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) hash.update(chunk);
    return {
      isMachO: isMachOHeader(header, bytesRead),
      sha256: hash.digest('hex'),
      size: info.size,
    };
  } finally {
    await handle.close();
  }
}

function isMachOHeader(header, bytesRead) {
  if (bytesRead < 4) return false;
  const magic = header.subarray(0, 4).toString('hex');
  if (thinMachOMagic.has(magic)) return true;
  const byteOrder = fatMachOMagic.get(magic);
  if (!byteOrder || bytesRead < 8) return false;
  const architectureCount = byteOrder === 'BE' ? header.readUInt32BE(4) : header.readUInt32LE(4);
  return architectureCount > 0 && architectureCount <= 20;
}

function symlinkTargetScope(app, link, target) {
  const resolved = path.resolve(path.dirname(link), target);
  const relative = path.relative(app, resolved);
  const inside = relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
  return inside ? 'inside-bundle' : 'outside-bundle';
}

function normalizeOtoolOutput(output, file, relativePath) {
  const lines = output.replaceAll('\r\n', '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  assert.ok(lines.length > 0, `otool -L produced no output for ${relativePath}`);
  assert.ok(
    lines[0] === `${file}:` || lines[0].startsWith(`${file} (architecture `),
    `otool -L output did not identify ${relativePath}`,
  );
  let foundHeader = false;
  const normalized = lines.map(line => {
    if (line === `${file}:` || line.startsWith(`${file} (architecture `)) {
      foundHeader = true;
      return `${relativePath}${line.slice(file.length)}`;
    }
    return line;
  });
  assert.ok(foundHeader, `otool -L produced no file header for ${relativePath}`);
  return `${normalized.join('\n')}\n`;
}

async function collectAppEvidence(app, run) {
  const appInventory = [];
  const machOFiles = [];

  async function visit(directory, segments, depth) {
    assert.ok(depth <= maximumInventoryDepth, `App inventory exceeds ${maximumInventoryDepth} directory levels`);
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      assert.ok(appInventory.length < maximumInventoryEntries, `App inventory exceeds ${maximumInventoryEntries} entries`);
      const entrySegments = [...segments, entry.name];
      const relativePath = entrySegments.join('/');
      const absolutePath = path.join(directory, entry.name);
      const info = await fsp.lstat(absolutePath);
      if (info.isSymbolicLink()) {
        const target = await fsp.readlink(absolutePath);
        appInventory.push({
          path: relativePath,
          target,
          targetScope: symlinkTargetScope(app, absolutePath, target),
          type: 'symlink',
        });
      } else if (info.isDirectory()) {
        appInventory.push({ path: relativePath, type: 'directory' });
        await visit(absolutePath, entrySegments, depth + 1);
      } else if (info.isFile()) {
        const inspected = await inspectRegularFile(absolutePath);
        const inventoryEntry = {
          path: relativePath,
          sha256: inspected.sha256,
          size: inspected.size,
          type: 'file',
        };
        appInventory.push(inventoryEntry);
        if (inspected.isMachO) {
          const output = run('otool', ['-L', absolutePath]).stdout;
          machOFiles.push({
            path: relativePath,
            sha256: inspected.sha256,
            otoolL: normalizeOtoolOutput(output, absolutePath, relativePath),
          });
        }
      } else {
        throw new Error(`Unsupported app inventory entry type: ${relativePath}`);
      }
    }
  }

  await visit(app, [], 0);
  appInventory.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  machOFiles.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return { appInventory, machOFiles };
}

function validateBundledNotices(appInventory, expectedSha256) {
  if (!expectedSha256) return;
  const noticePath = 'Contents/Resources/THIRD-PARTY-NOTICES.json';
  const matches = appInventory.filter(entry => entry.path === noticePath);
  assert.equal(matches.length, 1, 'Required bundled notices are missing');
  assert.equal(matches[0].type, 'file', 'Bundled notices must be a regular file');
  assert.equal(matches[0].sha256, expectedSha256, 'Bundled notices SHA-256 mismatch');
}

function validateBundledIcon(appInventory, info, expectedSha256) {
  if (!expectedSha256) return;
  const iconPath = 'Contents/Resources/icon.icns';
  const matches = appInventory.filter(entry => entry.path === iconPath);
  assert.equal(matches.length, 1, 'Required bundled icon is missing');
  assert.equal(matches[0].type, 'file', 'Bundled icon must be a regular file');
  assert.equal(matches[0].sha256, expectedSha256, 'Bundled icon SHA-256 mismatch');
  assert.equal(info.CFBundleIconFile, 'icon.icns', 'Unexpected bundle icon metadata');
}

async function writeEvidence(file, evidence) {
  let created = false;
  try {
    const handle = await fsp.open(file, 'wx', 0o600);
    created = true;
    try {
      await handle.writeFile(`${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (created) await fsp.rm(file, { force: true });
    throw new Error(`Failed to retain DMG evidence at ${file}: ${error.message}`);
  }
}

async function validateDmgDirectory(options, dependencies = {}) {
  const {
    bundleDirectory,
    expectedVersion,
    expectedArch,
    expectedSha256,
    expectedIconSha256,
    expectedNoticesSha256,
    signaturePolicy = 'required',
    evidenceFile,
  } = options;
  const platform = dependencies.platform || process.platform;
  assert.equal(platform, 'darwin', 'Native DMG validation requires macOS');
  assert.match(expectedVersion || '', versionPattern, 'Expected version must be an Apple short version with three numeric components');
  assert.ok(allowedArchitectures.has(expectedArch), 'Expected architecture must be arm64 or x86_64');
  assert.ok(allowedSignaturePolicies.has(signaturePolicy), 'Signature policy must be ad-hoc, required or observe');
  if (expectedSha256) assert.match(expectedSha256, /^[0-9a-f]{64}$/, 'Expected SHA-256 digest is invalid');
  if (expectedIconSha256) {
    assert.match(expectedIconSha256, /^[0-9a-f]{64}$/, 'Expected icon SHA-256 digest is invalid');
  }
  if (expectedNoticesSha256) {
    assert.match(expectedNoticesSha256, /^[0-9a-f]{64}$/, 'Expected notices SHA-256 digest is invalid');
  }

  const run = commandRunner(dependencies);
  const writeOutput = dependencies.writeOutput || (value => process.stdout.write(value));
  const evidenceDestination = await prepareEvidenceDestination(evidenceFile);
  const dmg = await findSingleDmg(bundleDirectory);
  const digest = await sha256(dmg);
  writeOutput(`DMG path: ${dmg}\nDMG SHA-256: ${digest}\n`);
  if (expectedSha256 && digest !== expectedSha256) {
    throw new Error(`DMG SHA-256 mismatch: expected ${expectedSha256}, received ${digest}`);
  }

  const hostVersion = run('sw_vers', []).stdout.trim();
  const hostArchitecture = run('uname', ['-m']).stdout.trim();
  run('hdiutil', ['imageinfo', dmg]);
  run('hdiutil', ['verify', dmg]);

  const temporaryRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'repodeck-dmg-'));
  const mountPoint = path.join(temporaryRoot, 'mount');
  await fsp.mkdir(mountPoint);
  let attachAttempted = false;
  let mountedDevice;
  let detached = false;
  let validationError;
  let result;

  try {
    attachAttempted = true;
    const attach = run('hdiutil', ['attach', '-readonly', '-nobrowse', '-plist', '-mountpoint', mountPoint, dmg], {
      allowFailure: true,
      input: 'Y\n',
    });
    if (attach.status !== 0) throw new Error(`hdiutil attach failed with status ${attach.status}`);
    const attachPlist = extractPlistXml(attach.stdout, 'hdiutil attach metadata');
    const attachJson = run('plutil', ['-convert', 'json', '-o', '-', '-'], { input: attachPlist }).stdout;
    mountedDevice = await exactMountedDevice(parseJsonOutput(attachJson, 'hdiutil attach metadata'), mountPoint);

    const app = path.join(mountPoint, 'RepoDeck.app');
    await requireRealDirectory(app, 'Expected RepoDeck.app');
    const infoPlist = path.join(app, 'Contents', 'Info.plist');
    const info = parseJsonOutput(run('plutil', ['-convert', 'json', '-o', '-', infoPlist]).stdout, 'RepoDeck Info.plist');
    assert.equal(info.CFBundleIdentifier, 'org.repodeck.desktop', 'Unexpected bundle identifier');
    assert.equal(info.CFBundleExecutable, 'repodeck-desktop', 'Unexpected bundle executable');
    assert.equal(info.CFBundleShortVersionString, expectedVersion, 'Unexpected bundle version');

    const executable = path.join(app, 'Contents', 'MacOS', info.CFBundleExecutable);
    await requireExecutable(executable);
    const architectures = run('lipo', ['-archs', executable]).stdout.trim().split(/\s+/).filter(Boolean);
    assert.deepEqual(architectures, [expectedArch], `Unexpected executable architecture: ${architectures.join(', ')}`);

    const { appInventory, machOFiles } = await collectAppEvidence(app, run);
    const executableRelativePath = ['Contents', 'MacOS', info.CFBundleExecutable].join('/');
    assert.ok(
      machOFiles.some(entry => entry.path === executableRelativePath),
      'Expected RepoDeck executable is not a Mach-O regular file',
    );
    validateBundledIcon(appInventory, info, expectedIconSha256);
    validateBundledNotices(appInventory, expectedNoticesSha256);

    const allowSignatureFailure = signaturePolicy === 'observe';
    const verification = run('codesign', ['--verify', '--deep', '--strict', '--verbose=4', app], { allowFailure: allowSignatureFailure });
    const signatureInfo = run('codesign', ['--display', '--verbose=4', app], { allowFailure: allowSignatureFailure });
    const signatureText = `${signatureInfo.stdout}\n${signatureInfo.stderr}`;
    const signature = verification.status !== 0 || signatureInfo.status !== 0
      ? 'invalid-or-unsigned'
      : /^Signature=adhoc$/m.test(signatureText) ? 'ad-hoc' : 'valid';
    if (signaturePolicy === 'ad-hoc') assert.equal(signature, 'ad-hoc', 'An ad-hoc code signature is required');
    if (signaturePolicy === 'required') assert.notEqual(signature, 'invalid-or-unsigned', 'A valid code signature is required');

    const evidence = {
      schemaVersion: 1,
      architecture: architectures[0],
      appInventory,
      appPath: 'RepoDeck.app',
      dmgFilename: path.basename(dmg),
      dmgSha256: digest,
      machOFiles,
      signature,
      version: info.CFBundleShortVersionString,
    };
    result = {
      ...evidence,
      hostArchitecture,
      hostVersion,
      path: dmg,
      sha256: digest,
    };
  } catch (error) {
    validationError = error;
  }

  let cleanupError;
  const detachTarget = mountedDevice || (attachAttempted ? mountPoint : undefined);
  if (detachTarget) {
    try {
      run('hdiutil', ['detach', detachTarget]);
      detached = true;
    } catch (error) {
      const targetKind = mountedDevice ? 'mounted device' : 'requested mountpoint';
      cleanupError = new Error(`Failed to detach exact ${targetKind} ${detachTarget}: ${error.message}`);
    }
  }

  if (!attachAttempted || detached) await fsp.rm(temporaryRoot, { recursive: true, force: true });
  if (cleanupError && validationError) {
    throw new AggregateError([validationError, cleanupError], `${validationError.message}; ${cleanupError.message}`);
  }
  if (cleanupError) throw cleanupError;
  if (validationError) throw validationError;

  const retainedEvidence = {
    schemaVersion: result.schemaVersion,
    dmgFilename: result.dmgFilename,
    dmgSha256: result.dmgSha256,
    architecture: result.architecture,
    version: result.version,
    signature: result.signature,
    appPath: result.appPath,
    appInventory: result.appInventory,
    machOFiles: result.machOFiles,
  };
  await writeEvidence(evidenceDestination, retainedEvidence);
  writeOutput(`Retained DMG evidence: ${evidenceDestination}\n`);
  writeOutput(`DMG validation evidence:\n${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (require.main === module) {
  let options;
  try {
    options = parseCliArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
  if (options) {
    validateDmgDirectory(options).catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
  }
}

module.exports = {
  defaultExecute,
  appleShortVersion,
  extractPlistXml,
  parseCliArguments,
  validateDmgDirectory,
};
