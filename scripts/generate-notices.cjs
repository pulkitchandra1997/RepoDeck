const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify, TextDecoder } = require('node:util');
const semver = require('semver');
const { createHash } = require('node:crypto');

const TARGETS = Object.freeze(['x86_64-pc-windows-msvc', 'aarch64-apple-darwin', 'x86_64-apple-darwin']);
const LIMIT = 32 * 1024 * 1024;
class NoticeError extends Error {}
function requireNotice(ok, message) { if (!ok) throw new NoticeError(message); }
const sorted = values => [...values].sort();
const sha256 = value => createHash('sha256').update(value).digest('hex');
const isLicenseFile = file => /^(licen[cs]e|copying)(?:$|[._-])/i.test(path.posix.basename(file));
const safeRelative = file => typeof file === 'string' && file.length <= 512 && file.split('/').every(part => /^[a-zA-Z0-9_.-]+$/.test(part) && part !== '.' && part !== '..');
const sourceUrl = source => `${source.repository.replace(/\/$/, '')}/blob/${source.revision}/${source.file}`;
function httpsUrl(value) {
  if (typeof value !== 'string' || value.length > 1024) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash && url.href === value;
  } catch { return false; }
}
function referencesUrl(text, url) {
  const index = text.indexOf(url);
  // A hostname/path prefix alone is not the URL named in the source notice.
  return index >= 0 && /^(?:$|[\s<>"')\],;]|\.(?:\s|$))/.test(text.slice(index + url.length));
}
function checkPrivate(value, privateRoots, label) {
  const combined = value.replaceAll('\\', '/').toLowerCase();
  requireNotice(!privateRoots.some(root => root && combined.includes(root.replaceAll('\\', '/').toLowerCase())) && !/(?:\b[a-z]:\/|\/(?:users|home)\/|(?<![:/])\/\/[^/\s]+\/)/i.test(combined), `${label}: private path in notice text or filename; review original locally`);
}
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
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, bytesRead));
  } finally { await handle.close(); }
}
async function json(file) { return JSON.parse(await read(file)); }

async function sdkSupplement(root, entry, budget, privateRoots) {
  requireNotice(safeRelative(entry.supplement), 'Invalid SDK supplement location');
  const file = path.join(root, 'scripts/license-fallbacks', entry.supplement);
  requireNotice((await fs.lstat(file)).isFile() && await fs.realpath(file) === file, 'SDK supplement must be a regular unlinked file');
  const sdk = JSON.parse(await read(file, 256 * 1024));
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  requireNotice(sdk.schemaVersion === 1 && sdk.status === 'evidence-only' && ['name', 'version', 'repository', 'revision', 'pathInVcs'].every(key => sdk.crate?.[key] === entry[key]), 'SDK supplement crate provenance mismatch');
  requireNotice(sdk.sdk?.name === 'Microsoft.Web.WebView2' && /^\d+\.\d+\.\d+\.\d+$/.test(sdk.sdk.version), 'Unsupported SDK package');
  const archiveUrl = `https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/${sdk.sdk.version}/microsoft.web.webview2.${sdk.sdk.version}.nupkg`;
  requireNotice(sdk.archiveUrl === archiveUrl && hash(sdk.archiveSha256), 'Invalid SDK archive provenance');
  const updatePrefix = `${entry.repository}/blob/${entry.revision}/`;
  requireNotice(typeof sdk.sdk.updateSource === 'string' && sdk.sdk.updateSource.startsWith(updatePrefix) && safeRelative(sdk.sdk.updateSource.slice(updatePrefix.length)), 'Invalid SDK update source provenance');
  const names = ['LICENSE.txt', 'NOTICE.txt', 'Microsoft.Web.WebView2.nuspec'];
  requireNotice(Array.isArray(sdk.texts) && sdk.texts.length === 3 && new Set(sdk.texts.map(text => text.file)).size === 3, 'Invalid SDK text inventory');
  for (const text of sdk.texts) {
    requireNotice(names.includes(text.file) && typeof text.text === 'string' && text.text.trim() && Buffer.byteLength(text.text) <= 128 * 1024 && hash(text.sha256) && sha256(text.text) === text.sha256, 'SDK text hash or size mismatch');
    checkPrivate(text.text, privateRoots, 'SDK');
  }
  requireNotice(Array.isArray(sdk.matchedFiles) && sdk.matchedFiles.length === 9 && new Set(sdk.matchedFiles.map(file => file.crateFile)).size === 9, 'Invalid SDK binary inventory');
  for (const file of sdk.matchedFiles) {
    requireNotice(typeof file.crateFile === 'string' && /^(arm64|x64|x86)\/WebView2Loader(?:\.dll(?:\.lib)?|Static\.lib)$/.test(file.crateFile) && file.archiveFile === `build/native/${file.crateFile}` && hash(file.sha256) && Number.isInteger(file.bytes) && file.bytes > 0 && file.bytes <= 16 * 1024 * 1024, 'Invalid SDK binary path, hash or size');
  }
  reserve(budget, sdk);
  return { archiveUrl: sdk.archiveUrl, archiveSha256: sdk.archiveSha256,
    sdk: { name: sdk.sdk.name, version: sdk.sdk.version, updateSource: sdk.sdk.updateSource },
    texts: sdk.texts.map(({ file, text, sha256 }) => ({ file, text, sha256 })),
    matchedFiles: sdk.matchedFiles.map(({ archiveFile, crateFile, bytes, sha256 }) => ({ archiveFile, crateFile, bytes, sha256 })) };
}

async function verifySdkBinary(directory, expected) {
  const file = path.join(await fs.realpath(directory), expected.crateFile);
  requireNotice((await fs.lstat(file)).isFile() && await fs.realpath(file) === file, 'SDK binary must be a regular unlinked package file');
  const handle = await fs.open(file, 'r');
  try {
    requireNotice((await handle.stat()).size === expected.bytes, 'SDK binary size mismatch');
    const hash = createHash('sha256'), buffer = Buffer.alloc(64 * 1024);
    let total = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      requireNotice(total <= expected.bytes, 'SDK binary size limit exceeded');
      hash.update(buffer.subarray(0, bytesRead));
    }
    requireNotice(total === expected.bytes && hash.digest('hex') === expected.sha256, 'SDK binary hash mismatch');
  } finally { await handle.close(); }
}

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

async function texts(directory, declaredFile, label, privateRoots, budget, allowMissing = false) {
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
  requireNotice(allowMissing || [...files].some(file => isLicenseFile(file) || file === declaredFile), `${label}: missing license text`);
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
    checkPrivate(`${file}\n${text}`, privateRoots.concat(base), label);
    reserve(budget, { file, text });
    result.push({ file, text, sha256: sha256(text), provenance: { kind: 'package' } });
  }
  return result;
}

async function loadFallbacks(root, budget, privateRoots) {
  const file = path.join(root, 'scripts/license-fallbacks/manifest.json');
  let stat;
  try { stat = await fs.lstat(file); }
  catch (error) { if (error.code === 'ENOENT') return new Map(); throw error; }
  requireNotice(stat.isFile() && await fs.realpath(file) === file, 'Fallback manifest must be a regular file, not linked or escaping the checkout');
  const manifest = JSON.parse(await read(file, 4 * 1024 * 1024));
  requireNotice(manifest.schemaVersion === 1 && Array.isArray(manifest.sources) && manifest.sources.length <= 128 && Array.isArray(manifest.packages) && manifest.packages.length <= 256, 'Invalid fallback manifest or entry limit');
  const pinned = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
  const repository = value => typeof value === 'string' && /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/?$/.test(value);
  const sourceKeys = new Set();
  for (const source of manifest.sources) {
    requireNotice(repository(source.repository) && pinned(source.revision) && safeRelative(source.file), 'Invalid fallback upstream location; immutable revision and relative path required');
    requireNotice(['license', 'notice', 'evidence'].includes(source.role), 'Invalid fallback source role');
    requireNotice(typeof source.text === 'string' && source.text.trim() && Buffer.byteLength(source.text) <= 2 * 1024 * 1024, 'Fallback text empty or size limit exceeded');
    requireNotice(typeof source.sha256 === 'string' && /^[a-f0-9]{64}$/.test(source.sha256) && sha256(source.text) === source.sha256, 'Fallback text hash mismatch');
    const key = `${source.repository}/${source.revision}/${source.file}`;
    requireNotice(!sourceKeys.has(key), 'Duplicate fallback source');
    sourceKeys.add(key);
    checkPrivate(`${source.repository}\n${source.file}\n${source.text}`, privateRoots, 'Fallback');
  }
  const result = new Map();
  for (const entry of manifest.packages) {
    const key = identity(entry.name, entry.version);
    requireNotice(!result.has(key), 'Duplicate fallback package');
    requireNotice(repository(entry.repository) && pinned(entry.revision) && (entry.pathInVcs === null || entry.pathInVcs === '' || safeRelative(entry.pathInVcs)), 'Invalid fallback package provenance');
    licenseIdentifier(entry.license, 'Fallback');
    requireNotice(['text-reviewed', 'blocked'].includes(entry.status) && typeof entry.reason === 'string' && entry.reason.trim() && entry.reason.length <= 2048, 'Invalid fallback review status or reason');
    requireNotice(Array.isArray(entry.sources) && entry.sources.length <= 32 && new Set(entry.sources).size === entry.sources.length && entry.sources.every(index => Number.isInteger(index) && manifest.sources[index]), 'Invalid fallback source references');
    const samePackage = source => source.repository === entry.repository && source.revision === entry.revision;
    const linkedTerms = entry.linkedTerms ?? [];
    requireNotice(Array.isArray(linkedTerms) && linkedTerms.length <= 32, 'Invalid linked terms limit');
    const links = new Map();
    for (const link of linkedTerms) {
      requireNotice(Number.isInteger(link.source) && Number.isInteger(link.declaration) && entry.sources.includes(link.source) && entry.sources.includes(link.declaration) && !links.has(link.source), 'Invalid or duplicate linked terms reference');
      const source = manifest.sources[link.source], declaration = manifest.sources[link.declaration];
      requireNotice(source.role === 'license' && !samePackage(source) && samePackage(declaration) && declaration.role === 'evidence', 'Linked terms require same-package declaration evidence');
      requireNotice(safeRelative(link.packageFile) && typeof entry.pathInVcs === 'string' && declaration.file === (entry.pathInVcs ? `${entry.pathInVcs}/` : '') + link.packageFile, 'Invalid linked terms package path');
      requireNotice(httpsUrl(link.url) && httpsUrl(link.textUrl) && referencesUrl(declaration.text, link.url), 'Linked terms URL is not present in declaration evidence');
      checkPrivate(`${link.url}\n${link.textUrl}`, privateRoots, 'Linked terms');
      links.set(link.source, { ...link, declaration });
    }
    const sources = entry.sources.map(index => {
      const source = manifest.sources[index], link = links.get(index);
      requireNotice(samePackage(source) || link, 'Fallback source does not match package provenance');
      return { ...source, applicability: link ? { url: link.url, textUrl: link.textUrl, packageFile: link.packageFile,
        declarationUrl: sourceUrl(link.declaration), declarationSha256: link.declaration.sha256 } : undefined };
    });
    requireNotice(entry.status === 'blocked' || sources.some(source => source.role === 'license'), 'Fallback requires reviewed license text');
    requireNotice(sources.reduce((sum, source) => sum + Buffer.byteLength(source.text), 0) <= 8 * 1024 * 1024, 'Fallback package text limit exceeded');
    checkPrivate(entry.reason, privateRoots, 'Fallback');
    const supplement = entry.supplement === undefined ? undefined : await sdkSupplement(root, entry, budget, privateRoots);
    result.set(key, { ...entry, sources, linkedTerms: [...links.values()], supplement });
  }
  reserve(budget, manifest);
  return result;
}

async function cargoTexts(pkg, label, privateRoots, budget, fallbacks) {
  const directory = path.dirname(pkg.manifest_path);
  const local = await texts(directory, pkg.license_file, label, privateRoots, budget, true);
  const fallback = fallbacks.get(identity(pkg.name, pkg.version));
  let reason;
  if (fallback) {
    requireNotice(pkg.source === 'registry+https://github.com/rust-lang/crates.io-index' && pkg.repository === fallback.repository && pkg.license === fallback.license, `${label}: fallback package identity mismatch`);
    const vcsFile = path.join(await fs.realpath(directory), '.cargo_vcs_info.json');
    requireNotice((await fs.lstat(vcsFile)).isFile() && await fs.realpath(vcsFile) === vcsFile, `${label}: linked fallback provenance is unsupported`);
    const vcs = JSON.parse(await read(vcsFile, 16384));
    requireNotice(vcs.git?.sha1 === fallback.revision && vcs.git?.dirty !== true && (vcs.path_in_vcs ?? null) === fallback.pathInVcs, `${label}: fallback revision or crate path mismatch`);
    for (const link of fallback.linkedTerms) {
      const file = path.join(await fs.realpath(directory), link.packageFile);
      requireNotice((await fs.lstat(file)).isFile() && await fs.realpath(file) === file, `${label}: declaration must be a regular unlinked package file`);
      requireNotice(sha256(await read(file, 2 * 1024 * 1024)) === link.declaration.sha256, `${label}: declaration hash differs from pinned evidence`);
    }
    for (const source of fallback.sources) {
      const evidence = { file: source.file, text: source.text, sha256: source.sha256,
        provenance: { kind: 'pinned-upstream', repository: source.repository, revision: source.revision,
          url: sourceUrl(source), role: source.role, ...(source.applicability ? { applicability: source.applicability } : {}) } };
      reserve(budget, evidence);
      local.push(evidence);
    }
    if (fallback.supplement) {
      const sdk = fallback.supplement;
      for (const file of sdk.matchedFiles) await verifySdkBinary(directory, file);
      for (const text of sdk.texts) {
        const evidence = { ...text, provenance: { kind: 'pinned-archive', url: sdk.archiveUrl,
          archiveSha256: sdk.archiveSha256, sdk: sdk.sdk, matchedFiles: sdk.matchedFiles,
          role: text.file === 'LICENSE.txt' ? 'license' : text.file === 'NOTICE.txt' ? 'notice' : 'evidence' } };
        reserve(budget, evidence);
        local.push(evidence);
      }
    }
    if (fallback.status === 'blocked') reason = fallback.reason;
  }
  const hasLicense = local.some(item => item.provenance.kind === 'package'
    ? isLicenseFile(item.file) || item.file === pkg.license_file : item.provenance.role === 'license');
  if (!hasLicense && !reason) reason = 'Missing license text; no reviewed pinned upstream fallback';
  requireNotice(local.reduce((sum, item) => sum + Buffer.byteLength(item.text), 0) <= 8 * 1024 * 1024, `${label}: notice text limit exceeded`);
  return { texts: local, licenseTextAvailable: hasLicense, ...(reason ? { unresolved: reason } : {}) };
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

async function cargoPackages(root, target, metadata, budget, privateRoots, fallbacks) {
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
      result.push({ ecosystem: 'cargo', name: pkg.name, version: pkg.version, license, targets: [target], ...await cargoTexts(pkg, label, privateRoots, budget, fallbacks) });
    }
    for (const dep of node.deps) {
      requireNotice(Array.isArray(dep.dep_kinds) && dep.dep_kinds.length > 0 && dep.dep_kinds.every(kind => [null, 'build', 'dev'].includes(kind.kind)), 'Unsupported Cargo metadata dependency kind');
      if (dep.dep_kinds.some(kind => kind.kind !== 'dev')) queue.push(dep.pkg);
      requireNotice(queue.length <= 100000, 'Cargo edge limit exceeded');
    }
  }
  return result;
}

async function generateNotices({ root = process.cwd(), metadata, exec = promisify(execFile), inventory = false } = {}) {
  try {
    const requestedRoot = path.resolve(root);
    root = await fs.realpath(root);
    const privateRoots = [requestedRoot, root];
    const budget = { bytes: 1024 };
    const fallbacks = await loadFallbacks(root, budget, privateRoots);
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
      records.push(...await cargoPackages(root, target, data, budget, privateRoots, fallbacks));
    }
    const merged = new Map();
    for (const record of records) {
      const key = `${record.ecosystem}:${record.name}@${record.version}`;
      const previous = merged.get(key);
      if (previous) {
        requireNotice(previous.license === record.license && previous.unresolved === record.unresolved && JSON.stringify(previous.texts) === JSON.stringify(record.texts), `${key}: conflicting license evidence`);
        previous.targets = sorted(new Set([...previous.targets, ...record.targets]));
      } else merged.set(key, record);
    }
    const packages = sorted(merged.keys()).map(key => merged.get(key));
    const unresolved = packages.filter(pkg => pkg.unresolved).map(pkg => ({ ecosystem: pkg.ecosystem, name: pkg.name, version: pkg.version, targets: pkg.targets, reason: pkg.unresolved }));
    requireNotice(inventory || unresolved.length === 0, `Unresolved dependency notices after all 3 target inventories: ${unresolved.map(pkg => `${pkg.name}@${pkg.version}: ${pkg.reason}`).join('; ')}`);
    const output = JSON.stringify({ schemaVersion: 2, collectionComplete: unresolved.length === 0, targets: TARGETS,
      review: 'Collected dependency declarations and source texts; not legal clearance. Incomplete inventories MUST NOT be bundled. Review distribution obligations, bundled/native components and build feature coverage before release.',
      unresolved, packages }, null, 2) + '\n';
    requireNotice(Buffer.byteLength(output) <= LIMIT, 'Artifact size limit exceeded');
    return output;
  } catch (error) {
    if (error instanceof NoticeError) throw error;
    throw new NoticeError('Notice collection failed: unreadable, malformed or unsupported input; inspect dependency files locally');
  }
}

async function runCli(args, options = {}) {
  const inventory = args[0] === '--inventory';
  const bundle = args[0] === '--bundle';
  requireNotice((inventory && args.length === 2 && !args[1].startsWith('--')) || (args.length === 1 && (bundle || !args[0].startsWith('--'))), 'Usage: node scripts/generate-notices.cjs [--inventory] OUTPUT.json | --bundle (new file only)');
  const root = await fs.realpath(options.root || process.cwd());
  const output = await generateNotices({ ...options, root, inventory });
  const destination = path.resolve(root, bundle ? '.tools/notices/THIRD-PARTY-NOTICES.json' : args[inventory ? 1 : 0]);
  if (bundle) {
    let directory = root;
    for (const part of ['.tools', 'notices']) {
      directory = path.join(directory, part);
      try { await fs.mkdir(directory); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      requireNotice((await fs.lstat(directory)).isDirectory() && await fs.realpath(directory) === directory, 'Unsupported linked bundle output directory');
    }
  }
  await fs.writeFile(destination, output, { flag: 'wx' });
}

if (require.main === module) {
  runCli(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error instanceof NoticeError ? error.message : 'Cannot write notices artifact; use a new writable output file'}\n`);
    process.exitCode = 1;
  });
}

module.exports = { generateNotices, runCli, TARGETS };
