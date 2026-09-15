const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const { assetName } = require('./release-lib.cjs');
const { checkRelease } = require('./check-release.cjs');

async function stageRelease(root, destination, version, target, commit) {
  const name = assetName(version, target);
  assert.match(commit, /^[0-9a-f]{40}$/, 'A full source commit SHA is required');
  const rootInfo = await fs.lstat(root);
  assert.ok(rootInfo.isDirectory() && !rootInfo.isSymbolicLink(), 'Bundle root must be a real directory');
  const extension = path.extname(name);
  const candidates = [];
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      assert.ok(!entry.isSymbolicLink(), 'Bundle tree must not contain symbolic links');
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && path.extname(entry.name) === extension) candidates.push(file);
    }
  }
  // Scan only the installer directory, not macOS .app symlink trees.
  await visit(root);
  assert.equal(candidates.length, 1, 'Expected exactly one installer');
  const size = (await fs.stat(candidates[0])).size;
  assert.ok(size > 0 && size < 2 ** 31, 'Installer must not be empty or exceed the release size limit');
  const bytes = await fs.readFile(candidates[0]);
  assert.ok(bytes.length > 0, 'Installer must not be empty');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(path.join(destination, name), bytes, { flag: 'wx' });
  await fs.writeFile(path.join(destination, `${name}.sha256`), `${sha256}  ${name}\n`, { flag: 'wx' });
  await fs.writeFile(path.join(destination, `${name}.json`), JSON.stringify({ version, target, commit, file: name, sha256, signing: 'unsigned-development' }, null, 2) + '\n', { flag: 'wx' });
  return name;
}
if (require.main === module) {
  const [root, target] = process.argv.slice(2);
  stageRelease(root, '.tools/release-assets', checkRelease(), target, process.env.GITHUB_SHA || '')
    .then(name => console.log(`Staged ${name}`)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { stageRelease };
