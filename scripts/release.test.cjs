const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateVersions, assetName } = require('./release-lib.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { stageRelease } = require('./stage-release.cjs');

test('requires matching manifest versions and release tags', () => {
  assert.equal(validateVersions(['0.1.0', '0.1.0', '0.1.0'], 'refs/tags/v0.1.0'), '0.1.0');
  assert.throws(() => validateVersions(['0.1.0', '0.2.0'], ''), /mismatch/);
  assert.throws(() => validateVersions(['0.1.0'], 'refs/tags/v0.2.0'), /tag/);
  assert.throws(() => validateVersions(['../../bad'], ''), /version/);
  assert.throws(() => validateVersions([], ''), /version/);
});
test('asset names distinguish platform architecture and reject unknown targets', () => {
  assert.equal(assetName('0.1.0', 'x86_64-pc-windows-msvc'), 'RepoDeck_0.1.0_windows_x64-setup.exe');
  assert.equal(assetName('0.1.0', 'aarch64-apple-darwin'), 'RepoDeck_0.1.0_macos_arm64.dmg');
  assert.equal(assetName('0.1.0', 'x86_64-apple-darwin'), 'RepoDeck_0.1.0_macos_x64.dmg');
  assert.throws(() => assetName('0.1.0', 'other'), /target/);
});
test('stages one nonempty installer with checksum and refuses replacement or ambiguity', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repodeck-release-test-'));
  try {
    const bundles = path.join(root, 'bundles'), output = path.join(root, 'output');
    await fs.mkdir(bundles);
    const args = [bundles, output, '0.1.0', 'x86_64-pc-windows-msvc', 'a'.repeat(40)];
    await assert.rejects(stageRelease(...args), /exactly one/);
    await fs.writeFile(path.join(bundles, 'fixture.exe'), '');
    await assert.rejects(stageRelease(...args), /empty/);
    await fs.writeFile(path.join(bundles, 'fixture.exe'), 'test data, not executable');
    const name = await stageRelease(...args);
    const metadata = JSON.parse(await fs.readFile(path.join(output, `${name}.json`), 'utf8'));
    assert.equal(metadata.sha256, createHash('sha256').update('test data, not executable').digest('hex'));
    assert.equal(metadata.commit, 'a'.repeat(40));
    await assert.rejects(stageRelease(...args), /EEXIST/);
    await fs.writeFile(path.join(bundles, 'duplicate.exe'), 'another fixture');
    await assert.rejects(stageRelease(...args), /exactly one/);
  } finally {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('repodeck-release-test-'));
    await fs.rm(root, { recursive: true, force: true });
  }
});
