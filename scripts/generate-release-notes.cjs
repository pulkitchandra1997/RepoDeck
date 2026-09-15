const fs = require('node:fs');
const assert = require('node:assert/strict');
const { assetName } = require('./release-lib.cjs');
const { checkRelease, verifyPreviewSource, verifyReleaseAssets, releaseTargets, repository, previewPattern } = require('./check-release.cjs');

function validatePreviewNotes(data, version) {
  assert.match(version, previewPattern, 'Unsigned preview requires X.Y.Z-preview.N version');
  assert.ok(data && typeof data === 'object' && !Array.isArray(data), 'Expected version notes object');
  assert.deepEqual(Object.keys(data).sort(), ['channel', 'features', 'fixes', 'limitations', 'version'], 'Unexpected version notes fields');
  assert.equal(data.version, version, 'Notes version mismatch');
  assert.equal(data.channel, 'unsigned-preview', 'Explicit unsigned-preview channel required');
  for (const key of ['features', 'fixes', 'limitations']) {
    assert.ok(Array.isArray(data[key]) && data[key].length >= 1 && data[key].length <= 20, `Expected 1-20 ${key} notes`);
    for (const item of data[key]) {
      assert.ok(typeof item === 'string' && item.length <= 500 && item.trim() === item && item.length > 0,
        'Notes must be nonempty text up to 500 characters');
      // Deliberately plain ASCII prose: no HTML, links, control characters or Markdown syntax.
      assert.match(item, /^[A-Za-z0-9][A-Za-z0-9 .,;:!?()/'"+%=&-]*$/, 'Unsafe note text');
    }
  }
  return data;
}

function readPreviewNotes(version) {
  assert.match(version, previewPattern, 'Unsigned preview requires X.Y.Z-preview.N version');
  const file = `docs/releases/versions/${version}.json`;
  const info = fs.lstatSync(file);
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.size <= 32768, 'Notes must be a regular file up to 32 KiB');
  return validatePreviewNotes(JSON.parse(fs.readFileSync(file, 'utf8')), version);
}

function generateReleaseNotes(data, version, commit, manifests) {
  validatePreviewNotes(data, version);
  assert.match(commit, /^[0-9a-f]{40}$/, 'A full source commit SHA is required');
  assert.deepEqual(manifests.map(item => item.target), releaseTargets, 'Expected all three verified targets in order');
  for (const item of manifests) {
    assert.match(item.sha256, /^[0-9a-f]{64}$/, 'Invalid SHA-256 digest');
    assert.deepEqual(item, { version, target: item.target, commit, file: assetName(version, item.target), sha256: item.sha256, signing: 'unsigned-development' }, 'Notes manifest mismatch');
  }
  const base = `https://github.com/${repository}`;
  const download = `${base}/releases/download/v${version}`;
  const labels = ['Windows x64 installer (.exe)', 'macOS Apple Silicon installer (.dmg)', 'macOS Intel installer (.dmg)'];
  const lines = [`# RepoDeck ${version}`, '', '## Downloads', '',
    ...manifests.map((item, i) => `- **[${labels[i]}](${download}/${item.file})**`), '',
    'These are unsigned development previews, not stable releases. Windows SmartScreen warnings and macOS distribution restrictions may apply. They are not signed or notarized. Do not disable operating-system security controls.', '',
    'Git is required for repository status. Use trusted local checkouts and disposable test projects first. Automatic updates are not implemented.', ''];
  for (const [key, heading] of [['features', 'Features'], ['fixes', 'Fixes'], ['limitations', 'Known Limitations']]) {
    lines.push(`## ${heading}`, '', ...data[key].map(item => `- ${item}`), '');
  }
  lines.push('<details>', '<summary>Source, checksums and verification</summary>', '',
    `Source: [${commit}](${base}/commit/${commit}). Tag: v${version}.`, '',
    'The draft creation workflow requires successful Desktop verification across Windows x64, macOS ARM64 and macOS Intel. Build success does not prove native first-launch or installer lifecycle compatibility.', '',
    ...manifests.map(item => `- [${item.file}.sha256](${download}/${item.file}.sha256) | [source manifest](${download}/${item.file}.json): \`${item.sha256}\``), '',
    'Compare each downloaded installer with its SHA-256 using Get-FileHash -Algorithm SHA256 on Windows or shasum -a 256 on macOS. Checksums detect changed bytes; they are not code signatures.', '',
    `See the [release policy](${base}/blob/${commit}/docs/releases/release-guide.md) and [security policy](${base}/blob/${commit}/SECURITY.md). Source is MIT; dependencies retain their own licenses.`, '', '</details>', '');
  return lines.join('\n');
}

if (require.main === module) {
  (async () => {
    assert.equal(process.argv.length, 4, 'Usage: node scripts/generate-release-notes.cjs ASSET_DIRECTORY OUTPUT.md');
    const version = checkRelease();
    const data = readPreviewNotes(version);
    const commit = verifyPreviewSource(version);
    const manifests = await verifyReleaseAssets(process.argv[2], version, commit);
    fs.writeFileSync(process.argv[3], generateReleaseNotes(data, version, commit, manifests), { flag: 'wx' });
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { validatePreviewNotes, readPreviewNotes, generateReleaseNotes };
