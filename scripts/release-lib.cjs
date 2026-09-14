const assert = require('node:assert/strict');

function validateVersions(versions, ref = '') {
  assert.ok(versions.length && versions.every(value => typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(value)), 'Invalid release version');
  assert.ok(versions.every(value => value === versions[0]), 'Manifest version mismatch');
  if (ref.startsWith('refs/tags/')) assert.equal(ref, `refs/tags/v${versions[0]}`, 'Release tag must match manifest version');
  return versions[0];
}

function assetName(version, target) {
  validateVersions([version]);
  const suffix = new Map([
    ['x86_64-pc-windows-msvc', 'windows_x64-setup.exe'],
    ['aarch64-apple-darwin', 'macos_arm64.dmg'],
    ['x86_64-apple-darwin', 'macos_x64.dmg'],
  ]).get(target);
  assert.ok(suffix, 'Unsupported release target');
  return `RepoDeck_${version}_${suffix}`;
}
module.exports = { validateVersions, assetName };
