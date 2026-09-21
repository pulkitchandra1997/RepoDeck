const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

function requireNotice(condition, message) {
  if (!condition) throw new Error(message);
}

async function verifyExtractedNotices(root, expectedSha256) {
  requireNotice(typeof expectedSha256 === 'string' && /^[a-f0-9]{64}$/.test(expectedSha256),
    'Expected notice hash must be lowercase SHA-256');
  const resolvedRoot = path.resolve(root);
  const rootStat = await fs.lstat(resolvedRoot);
  requireNotice(rootStat.isDirectory() && !rootStat.isSymbolicLink(),
    'Extracted NSIS root must be a regular unlinked directory');

  const noticePath = path.join(resolvedRoot, 'THIRD-PARTY-NOTICES.json');
  let stat;
  try { stat = await fs.lstat(noticePath); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('Extracted NSIS notice resource is missing');
    throw error;
  }
  requireNotice(stat.isFile() && !stat.isSymbolicLink(),
    'Extracted NSIS notice resource must be a regular unlinked file');
  requireNotice(stat.size > 0 && stat.size <= 16 * 1024 * 1024,
    'Extracted NSIS notice resource has an invalid size');

  const bytes = await fs.readFile(noticePath);
  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  requireNotice(actualSha256 === expectedSha256, 'Extracted NSIS notice resource hash mismatch');
  const notice = JSON.parse(bytes.toString('utf8'));
  requireNotice(notice.schemaVersion === 3 && notice.collectionComplete === true,
    'Extracted NSIS notice resource is not a complete schema-v3 collection');
  requireNotice(notice.releaseGateComplete === true, 'Extracted NSIS notice release gate is incomplete');
  requireNotice(Array.isArray(notice.unresolved) && notice.unresolved.length === 0,
    'Extracted NSIS notice resource contains unresolved entries');
  requireNotice(Array.isArray(notice.pendingReview) && notice.pendingReview.length === 0,
    'Extracted NSIS notice resource contains pending review entries');
  requireNotice(Array.isArray(notice.packages) && notice.packages.length > 0,
    'Extracted NSIS notice package inventory is missing or empty');
  return { path: 'THIRD-PARTY-NOTICES.json', sha256: actualSha256 };
}

if (require.main === module) {
  const [, , root, expectedSha256] = process.argv;
  if (!root || !expectedSha256 || process.argv.length !== 4) {
    process.stderr.write('Usage: node scripts/windows/verify-nsis-notices.cjs EXTRACTED_DIR SHA256\n');
    process.exitCode = 1;
  } else {
    verifyExtractedNotices(root, expectedSha256)
      .then(result => process.stdout.write(`Verified ${result.path} (${result.sha256})\n`))
      .catch(error => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
      });
  }
}

module.exports = { verifyExtractedNotices };
