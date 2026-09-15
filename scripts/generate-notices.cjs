const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify, TextDecoder } = require('node:util');
const semver = require('semver');

const TARGETS = Object.freeze(['x86_64-pc-windows-msvc', 'aarch64-apple-darwin', 'x86_64-apple-darwin']);
const LIMIT = 32 * 1024 * 1024;
class NoticeError extends Error {}
function requireNotice(ok, message) { if (!ok) throw new NoticeError(message); }
const sorted = values => [...values].sort();
function reserve(budget, value) {
  // Count escaped text before retaining it; repeated target evidence counts too.
  budget.bytes += Buffer.byteLength(JSON.stringify(value)) + 1024;
  requireNotice(budget.bytes <= LIMIT, 'Aggregate notice collection limit exceeded');
}

async function read(file, limit = LIMIT) {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    requireNotice(stat.isFile() && stat.size <= limit, 'Input is not a bounded regular file');
    const bytes = Buffer.alloc(limit + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    requireNotice(bytesRead <= limit, 'Input exceeds size limit');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytesRead));
  } finally { await handle.close(); }
}
async function json(file) { return JSON.parse(await read(file)); }

function identity(name, version) {
  requireNotice(typeof name === 'string' && name.length <= 256 && /^(?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(name), 'Unsupported package name');
  requireNotice(typeof version === 'string' && version.length <= 256 && /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.+-]+)?$/.test(version), 'Unsupported package version');
  return `${name}@${version}`;
}

// Identifiers observed in the locked closure, not a legal allow/deny policy.
// Keep the upstream expression verbatim, including Cargo's legacy '/' separator.
function licenseIdentifier(value, label) {
  const ids = new Set(['0BSD', 'MIT', 'MIT-0', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'Zlib', 'CC0-1.0', 'Unlicense', 'Unicode-3.0', 'Unicode-DFS-2016', 'BSL-1.0', 'MPL-2.0']);
  requireNotice(typeof value === 'string' && value.length <= 256, `${label}: missing or unsupported license identifier`);
  const tokens = value.match(/[A-Za-z0-9.-]+|[()]|\S/g) || [];
  let cursor = 0;
  const atom = () => {
    if (tokens[cursor] === '(') {
      cursor++;
      expression();
      requireNotice(tokens[cursor++] === ')', `${label}: unsupported license identifier`);
    } else {
      requireNotice(ids.has(tokens[cursor++]), `${label}: unsupported license identifier`);
      if (tokens[cursor] === 'WITH') {
        cursor++;
        requireNotice(tokens[cursor++] === 'LLVM-exception', `${label}: unsupported license identifier exception`);
      }
    }
  };
  const expression = () => {
    atom();
    while (['OR', 'AND', '/'].includes(tokens[cursor])) { cursor++; atom(); }
  };
  expression();
  requireNotice(cursor === tokens.length, `${label}: unsupported license identifier`);
  return value;
}

async function texts(directory, declaredFile, label, privateRoots, budget) {
  const base = await fs.realpath(directory);
  const files = new Set();
  let visited = 0;
  async function scan(relative = '', depth = 0) {
    requireNotice(depth <= 5, `${label}: notice directory depth exceeded`);
    for (const entry of await fs.readdir(path.join(base, relative), { withFileTypes: true })) {
      requireNotice(++visited <= 2048, `${label}: notice entry limit exceeded`);
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const relevant = /^(licen[cs]e|copying|notice|copyright)(?:$|[._-])/i.test(entry.name);
      if (entry.isDirectory() && (relative || /^(licenses?|licences?|notices?)$/i.test(entry.name))) await scan(name, depth + 1);
      else if (relevant || relative) {
        requireNotice(entry.isFile(), `${label}: unsupported notice file type`);
        files.add(name);
      }
    }
  }
  await scan();
  if (declaredFile) {
    requireNotice(typeof declaredFile === 'string' && !path.isAbsolute(declaredFile) && !declaredFile.includes('\\') && !declaredFile.split('/').includes('..'), `${label}: unsupported license file location`);
    files.add(declaredFile);
  }
  requireNotice([...files].some(file => /^(licen[cs]e|copying)(?:$|[._-])/i.test(path.posix.basename(file)) || file === declaredFile), `${label}: missing license text`);
  const result = [];
  let total = 0;
  for (const file of sorted(files)) {
    const actual = await fs.realpath(path.join(base, file));
    const relative = path.relative(base, actual);
    requireNotice(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `${label}: notice escapes package`);
    const text = await read(actual, 2 * 1024 * 1024);
    requireNotice(text.trim().length > 0, `${label}: empty notice text`);
    total += Buffer.byteLength(text);
    requireNotice(total <= 8 * 1024 * 1024, `${label}: notice text limit exceeded`);
    const combined = `${file}\n${text}`.replaceAll('\\', '/').toLowerCase();
    requireNotice(!privateRoots.concat(base).some(root => root && combined.includes(root.replaceAll('\\', '/').toLowerCase())) && !/(?:\b[a-z]:\/|\/(?:users|home)\/|(?<![:/])\/\/[^/\s]+\/)/i.test(combined), `${label}: private path in notice text or filename; review original locally`);
    reserve(budget, { file, text });
    result.push({ file, text });
  }
  return result;
}

async function npmPackages(root, budget, privateRoots) {
  const lock = await json(path.join(root, 'package-lock.json'));
  requireNotice(lock.lockfileVersion === 3 && lock.packages?.[''], 'Requires package-lock v3 packages');
  requireNotice(Object.keys(lock.packages).length <= 20000, 'npm package limit exceeded');
  const manifest = await json(path.join(root, 'package.json'));
  const fields = ['dependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta'];
  const canonical = object => JSON.stringify(Object.entries(object || {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  requireNotice(fields.every(field => canonical(manifest[field]) === canonical(lock.packages[''][field])), 'Root manifest differs from lockfile');
  requireNotice(!manifest.workspaces, 'npm workspaces are unsupported');
  const queue = [''], seen = new Set(), result = [];
  for (let index = 0; index < queue.length; index++) {
    const location = queue[index];
    if (seen.has(location)) continue;
    seen.add(location);
    const pkg = lock.packages[location];
    requireNotice(pkg && !pkg.link && !pkg.inBundle, 'Unsupported npm link or bundled dependency');
    requireNotice(!pkg.os && !pkg.cpu && !pkg.libc, 'Unsupported platform-specific npm dependency');
    if (location) {
      const name = pkg.name || location.split('node_modules/').at(-1);
      const label = `npm ${identity(name, pkg.version)}`;
      const directory = path.join(root, location);
      let installed;
      try { installed = await json(path.join(directory, 'package.json')); }
      catch { throw new NoticeError(`${label}: missing or unreadable installed package`); }
      requireNotice(installed.name === name && installed.version === pkg.version && fields.every(field => canonical(installed[field]) === canonical(pkg[field])), `${label}: installed package differs from lockfile`);
      requireNotice(!installed.os && !installed.cpu && !installed.libc && !installed.bundledDependencies && !installed.bundleDependencies, `${label}: unsupported platform-specific npm or bundled dependency`);
      const license = licenseIdentifier(installed.license, label);
      requireNotice(!pkg.license || pkg.license === license, `${label}: license identifier differs from lockfile`);
      const actual = await fs.realpath(directory);
      requireNotice(actual === path.resolve(directory), `${label}: linked installed package is unsupported`);
      reserve(budget, { name, version: pkg.version, license, targets: TARGETS });
      result.push({ ecosystem: 'npm', name, version: pkg.version, license, targets: sorted(TARGETS), texts: await texts(directory, null, label, privateRoots, budget) });
    }
    const declarations = [pkg.dependencies, pkg.peerDependencies, pkg.optionalDependencies].filter(Boolean);
    const names = new Set(declarations.flatMap(group => Object.keys(group)));
    for (const name of sorted(names)) {
      identity(name, '0.0.0');
      let parent = location, found;
      while (true) {
        const candidate = parent ? `${parent}/node_modules/${name}` : `node_modules/${name}`;
        if (Object.hasOwn(lock.packages, candidate)) { found = candidate; break; }
        let exists = false;
        try { await fs.lstat(path.join(root, candidate)); exists = true; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        requireNotice(!exists, `npm ${name}: installed shadow is missing from lockfile`);
        if (!parent) break;
        const boundary = parent.lastIndexOf('/node_modules/');
        parent = boundary < 0 ? '' : parent.slice(0, boundary);
      }
      // Optional edges are also required: no silently incomplete cross-target artifact.
      requireNotice(found, `npm ${name}: unresolved dependency (including optional/peer)`);
      for (const group of declarations) {
        if (!Object.hasOwn(group, name)) continue;
        requireNotice(typeof group[name] === 'string' && semver.validRange(group[name]) && semver.satisfies(lock.packages[found].version, group[name]), `npm ${name}: unsupported range or incompatible version constraint`);
      }
      queue.push(found);
      requireNotice(queue.length <= 100000, 'npm edge limit exceeded');
    }
  }
  return result;
}

async function cargoPackages(root, target, metadata, budget, privateRoots) {
  requireNotice(metadata?.version === 1 && Array.isArray(metadata.packages) && Array.isArray(metadata.resolve?.nodes) && Array.isArray(metadata.workspace_members), 'Invalid or incomplete Cargo metadata');
  requireNotice(metadata.packages.length <= 10000 && metadata.resolve.nodes.length <= 10000, 'Cargo package limit exceeded');
  const packages = new Map(metadata.packages.map(pkg => [pkg.id, pkg]));
  const nodes = new Map(metadata.resolve.nodes.map(node => [node.id, node]));
  requireNotice(packages.size === metadata.packages.length && nodes.size === metadata.resolve.nodes.length, 'Duplicate Cargo metadata identity');
  const app = metadata.packages.filter(pkg => pkg.name === 'repodeck-desktop' && metadata.workspace_members.includes(pkg.id));
  requireNotice(app.length === 1, 'Cargo metadata must contain one workspace repodeck-desktop');
  const queue = [app[0].id], seen = new Set(), result = [];
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    if (seen.has(id)) continue;
    seen.add(id);
    const pkg = packages.get(id), node = nodes.get(id);
    requireNotice(pkg && Array.isArray(node?.deps), 'Incomplete Cargo metadata dependency graph');
    if (!metadata.workspace_members.includes(id)) {
      const label = `cargo ${identity(pkg.name, pkg.version)}`;
      const license = licenseIdentifier(pkg.license, label);
      requireNotice(typeof pkg.manifest_path === 'string' && path.isAbsolute(pkg.manifest_path), `${label}: invalid manifest location`);
      reserve(budget, { name: pkg.name, version: pkg.version, license, targets: [target] });
      result.push({ ecosystem: 'cargo', name: pkg.name, version: pkg.version, license, targets: [target], texts: await texts(path.dirname(pkg.manifest_path), pkg.license_file, label, privateRoots, budget) });
    }
    for (const dep of node.deps) {
      requireNotice(Array.isArray(dep.dep_kinds) && dep.dep_kinds.length > 0 && dep.dep_kinds.every(kind => [null, 'build', 'dev'].includes(kind.kind)), 'Unsupported Cargo metadata dependency kind');
      if (dep.dep_kinds.some(kind => kind.kind !== 'dev')) queue.push(dep.pkg);
      requireNotice(queue.length <= 100000, 'Cargo edge limit exceeded');
    }
  }
  return result;
}

async function generateNotices({ root = process.cwd(), metadata, exec = promisify(execFile) } = {}) {
  try {
    const requestedRoot = path.resolve(root);
    root = await fs.realpath(root);
    const privateRoots = [requestedRoot, root];
    const budget = { bytes: 1024 };
    const records = await npmPackages(root, budget, privateRoots);
    for (const target of TARGETS) {
      let data;
      if (metadata) data = await metadata(target);
      else {
        try {
          const { stdout } = await exec('cargo', ['metadata', '--locked', '--offline', '--format-version', '1', '--filter-platform', target], { cwd: root, shell: false, timeout: 120000, maxBuffer: LIMIT, windowsHide: true });
          data = JSON.parse(stdout);
        } catch { throw new NoticeError(`Cargo metadata failed for ${target}; check locked offline cache/toolchain locally`); }
      }
      records.push(...await cargoPackages(root, target, data, budget, privateRoots));
    }
    const merged = new Map();
    for (const record of records) {
      const key = `${record.ecosystem}:${record.name}@${record.version}`;
      const previous = merged.get(key);
      if (previous) {
        requireNotice(previous.license === record.license && JSON.stringify(previous.texts) === JSON.stringify(record.texts), `${key}: conflicting license evidence`);
        previous.targets = sorted(new Set([...previous.targets, ...record.targets]));
      } else merged.set(key, record);
    }
    const output = JSON.stringify({ schemaVersion: 1, targets: TARGETS, review: 'Collected dependency declarations and source texts; not a legal audit. Review distribution obligations, bundled/native components and build feature coverage before release.', packages: sorted(merged.keys()).map(key => merged.get(key)) }, null, 2) + '\n';
    requireNotice(Buffer.byteLength(output) <= LIMIT, 'Artifact size limit exceeded');
    return output;
  } catch (error) {
    if (error instanceof NoticeError) throw error;
    throw new NoticeError('Notice collection failed: unreadable, malformed or unsupported input; inspect dependency files locally');
  }
}

if (require.main === module) {
  (async () => {
    requireNotice(process.argv.length === 3, 'Usage: node scripts/generate-notices.cjs OUTPUT.json (new file only)');
    const output = await generateNotices();
    await fs.writeFile(process.argv[2], output, { flag: 'wx' });
  })().catch(error => {
    process.stderr.write(`${error instanceof NoticeError ? error.message : 'Cannot write notices artifact; use a new writable output file'}\n`);
    process.exitCode = 1;
  });
}

module.exports = { generateNotices, TARGETS };
