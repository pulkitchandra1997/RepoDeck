const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { validateVersions, assetName } = require('./release-lib.cjs');

const repository = 'pulkitchandra1997/RepoDeck';
const releaseTargets = ['x86_64-pc-windows-msvc', 'aarch64-apple-darwin', 'x86_64-apple-darwin'];
const previewPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-preview\.([1-9]\d*)$/;

function validatePreviewSource(expected, actual, pulls) {
  assert.match(expected, /^[0-9a-f]{40}$/, 'A full source commit SHA is required');
  assert.equal(actual, expected, 'Tag source must match the checked-out commit');
  assert.ok(Array.isArray(pulls) && pulls.some(pr => pr.merged_at && pr.merge_commit_sha === expected &&
    pr.base?.ref === 'main' && pr.base?.repo?.full_name === repository),
  'Preview source must be the exact merged PR commit on repository main');
}

function runReleaseCommand(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024,
  }).trim();
}

function verifyPreviewSource(version, env = process.env, run = runReleaseCommand) {
  assert.match(version, previewPattern, 'Unsigned preview requires X.Y.Z-preview.N version');
  assert.equal(env.GITHUB_REPOSITORY, repository, 'Unexpected release repository');
  assert.equal(env.GITHUB_REF, `refs/tags/v${version}`, 'Preview requires the exact version tag');
  const sha = env.GITHUB_SHA || '';
  assert.match(sha, /^[0-9a-f]{40}$/, 'A full source commit SHA is required');
  const actual = run('git', ['rev-parse', 'HEAD']);
  assert.equal(run('git', ['rev-parse', `refs/tags/v${version}^{commit}`]), sha, 'Tag source mismatch');
  const tagRef = `refs/tags/v${version}`;
  const remoteRefs = new Map(run('git', ['ls-remote', '--exit-code', 'origin', tagRef, `${tagRef}^{}`])
    .split('\n').map(line => { const [hash, ref] = line.split('\t'); return [ref, hash]; }));
  assert.equal(remoteRefs.get(`${tagRef}^{}`) || remoteRefs.get(tagRef), sha, 'Current remote tag source mismatch');
  run('git', ['merge-base', '--is-ancestor', sha, 'origin/main']);
  const pulls = JSON.parse(run('gh', ['api', '--paginate', '--slurp', `repos/${repository}/commits/${sha}/pulls?per_page=100`])).flat();
  validatePreviewSource(sha, actual, pulls);
  // Only a successful listing establishes absence; authentication/network errors fail closed.
  const releases = JSON.parse(run('gh', ['api', '--paginate', '--slurp', `repos/${repository}/releases?per_page=100`])).flat();
  assert.ok(!releases.some(release => release.tag_name === `v${version}`), 'Release already exists; never overwrite or resume a draft');
  return sha;
}

async function verifyReleaseAssets(root, version, commit) {
  validateVersions([version]);
  assert.match(commit, /^[0-9a-f]{40}$/, 'A full source commit SHA is required');
  const folders = await fs.promises.readdir(root, { withFileTypes: true });
  assert.deepEqual(folders.map(entry => entry.name).sort(), releaseTargets.map(target => `release-${target}`).sort(), 'Expected exactly three release targets');
  assert.ok(folders.every(entry => entry.isDirectory() && !entry.isSymbolicLink()), 'Release targets must be directories');
  const manifests = [];
  for (const target of releaseTargets) {
    const directory = path.join(root, `release-${target}`);
    const name = assetName(version, target);
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    assert.deepEqual(entries.map(entry => entry.name).sort(), [name, `${name}.json`, `${name}.sha256`].sort(), 'Unexpected release files');
    assert.ok(entries.every(entry => entry.isFile() && !entry.isSymbolicLink()), 'Release files must be regular files');
    const readSmall = async file => {
      assert.ok((await fs.promises.stat(file)).size <= 8192, 'Release metadata too large');
      return fs.promises.readFile(file, 'utf8');
    };
    const manifest = JSON.parse(await readSmall(path.join(directory, `${name}.json`)));
    assert.match(manifest.sha256, /^[0-9a-f]{64}$/, 'Invalid SHA-256 digest');
    assert.deepEqual(manifest, { version, target, commit, file: name, sha256: manifest.sha256, signing: 'unsigned-development' }, 'Release manifest mismatch');
    assert.equal(await readSmall(path.join(directory, `${name}.sha256`)), `${manifest.sha256}  ${name}\n`, 'Release checksum file mismatch');
    const installer = path.join(directory, name);
    const size = (await fs.promises.stat(installer)).size;
    assert.ok(size > 0 && size < 2 ** 31, 'Installer must be nonempty and smaller than 2 GiB');
    const hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(installer)) hash.update(chunk);
    assert.equal(hash.digest('hex'), manifest.sha256, 'Installer digest mismatch');
    manifests.push(manifest);
  }
  return manifests;
}

function checkRelease() {
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--locked', '--no-deps', '--format-version', '1'], { encoding: 'utf8', windowsHide: true }));
  const members = metadata.packages.filter(pkg => metadata.workspace_members.includes(pkg.id));
  return validateVersions([read('package.json').version, read('package-lock.json').version,
    read('package-lock.json').packages[''].version, read('src-tauri/tauri.conf.json').version,
    ...members.map(pkg => pkg.version)], process.env.GITHUB_REF || '');
}
module.exports = { checkRelease, validatePreviewSource, verifyPreviewSource, verifyReleaseAssets, releaseTargets, repository, previewPattern };

if (require.main === module) {
  const version = checkRelease();
  if (process.argv[2] === '--preview-policy') {
    const { readPreviewNotes } = require('./generate-release-notes.cjs');
    readPreviewNotes(version);
    verifyPreviewSource(version);
  } else assert.equal(process.argv.length, 2, 'Unknown release check arguments');
  console.log(`Release versions verified: ${version}`);
}
