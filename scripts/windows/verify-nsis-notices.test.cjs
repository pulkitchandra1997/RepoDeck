const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');

const modulePath = './verify-nsis-notices.cjs';

async function fixture(t, value = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repodeck-nsis-notices-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const notice = {
    schemaVersion: 3,
    collectionComplete: true,
    releaseGateComplete: true,
    unresolved: [],
    pendingReview: [],
    packages: [{ ecosystem: 'cargo', name: 'fixture', version: '1.0.0' }],
    ...value,
  };
  const bytes = `${JSON.stringify(notice, null, 2)}\n`;
  await fs.writeFile(path.join(root, 'THIRD-PARTY-NOTICES.json'), bytes);
  return { root, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

test('accepts the exact release-complete notice extracted at the NSIS archive root', async t => {
  const { verifyExtractedNotices } = require(modulePath);
  const f = await fixture(t);
  const result = await verifyExtractedNotices(f.root, f.sha256);
  assert.deepEqual(result, { path: 'THIRD-PARTY-NOTICES.json', sha256: f.sha256 });
});

test('rejects missing, altered, incomplete, pending-review, and linked notice resources', async t => {
  const { verifyExtractedNotices } = require(modulePath);
  const missing = await fs.mkdtemp(path.join(os.tmpdir(), 'repodeck-nsis-notices-missing-'));
  t.after(() => fs.rm(missing, { recursive: true, force: true }));
  await assert.rejects(verifyExtractedNotices(missing, 'a'.repeat(64)), /notice resource/i);

  const altered = await fixture(t);
  await assert.rejects(verifyExtractedNotices(altered.root, 'b'.repeat(64)), /hash/i);

  const incomplete = await fixture(t, { releaseGateComplete: false });
  await assert.rejects(verifyExtractedNotices(incomplete.root, incomplete.sha256), /release gate/i);

  const pending = await fixture(t, { pendingReview: [{ name: 'fixture' }] });
  await assert.rejects(verifyExtractedNotices(pending.root, pending.sha256), /pending review/i);

  const empty = await fixture(t, { packages: [] });
  await assert.rejects(verifyExtractedNotices(empty.root, empty.sha256), /package inventory/i);

  const linkedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'repodeck-nsis-notices-link-'));
  const outside = await fixture(t);
  t.after(() => fs.rm(linkedRoot, { recursive: true, force: true }));
  const linkedNotice = path.join(linkedRoot, 'THIRD-PARTY-NOTICES.json');
  if (process.platform === 'win32') await fs.mkdir(linkedNotice);
  else await fs.symlink(path.join(outside.root, 'THIRD-PARTY-NOTICES.json'), linkedNotice, 'file');
  await assert.rejects(verifyExtractedNotices(linkedRoot, outside.sha256), /regular unlinked/i);
});
