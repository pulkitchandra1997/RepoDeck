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
// Apple requires CFBundleShortVersionString to contain exactly three numeric components.
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const devicePattern = /^\/dev\/disk\d+(?:s\d+)*$/;

function defaultExecute(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    input: options.input,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120000,
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
    ['--signature', 'signaturePolicy'],
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
  assert.match(options.expectedVersion || '', versionPattern, '--version must be an Apple short version with three numeric components');
  assert.ok(allowedArchitectures.has(options.expectedArch), '--arch must be arm64 or x86_64');
  options.signaturePolicy ||= 'required';
  assert.ok(allowedSignaturePolicies.has(options.signaturePolicy), '--signature must be ad-hoc, required or observe');
  if (options.expectedSha256) assert.match(options.expectedSha256, /^[0-9a-f]{64}$/, '--sha256 must be a lowercase SHA-256 digest');
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

async function validateDmgDirectory(options, dependencies = {}) {
  const {
    bundleDirectory,
    expectedVersion,
    expectedArch,
    expectedSha256,
    signaturePolicy = 'required',
  } = options;
  const platform = dependencies.platform || process.platform;
  assert.equal(platform, 'darwin', 'Native DMG validation requires macOS');
  assert.match(expectedVersion || '', versionPattern, 'Expected version must be an Apple short version with three numeric components');
  assert.ok(allowedArchitectures.has(expectedArch), 'Expected architecture must be arm64 or x86_64');
  assert.ok(allowedSignaturePolicies.has(signaturePolicy), 'Signature policy must be ad-hoc, required or observe');
  if (expectedSha256) assert.match(expectedSha256, /^[0-9a-f]{64}$/, 'Expected SHA-256 digest is invalid');

  const run = commandRunner(dependencies);
  const writeOutput = dependencies.writeOutput || (value => process.stdout.write(value));
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

    const allowSignatureFailure = signaturePolicy === 'observe';
    const verification = run('codesign', ['--verify', '--deep', '--strict', '--verbose=4', app], { allowFailure: allowSignatureFailure });
    const signatureInfo = run('codesign', ['--display', '--verbose=4', app], { allowFailure: allowSignatureFailure });
    const signatureText = `${signatureInfo.stdout}\n${signatureInfo.stderr}`;
    const signature = verification.status !== 0 || signatureInfo.status !== 0
      ? 'invalid-or-unsigned'
      : /^Signature=adhoc$/m.test(signatureText) ? 'ad-hoc' : 'valid';
    if (signaturePolicy === 'ad-hoc') assert.equal(signature, 'ad-hoc', 'An ad-hoc code signature is required');
    if (signaturePolicy === 'required') assert.notEqual(signature, 'invalid-or-unsigned', 'A valid code signature is required');

    result = {
      architecture: architectures[0],
      hostArchitecture,
      hostVersion,
      path: dmg,
      sha256: digest,
      signature,
      version: info.CFBundleShortVersionString,
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
  appleShortVersion,
  extractPlistXml,
  parseCliArguments,
  validateDmgDirectory,
};
