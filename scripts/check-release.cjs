const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { validateVersions } = require('./release-lib.cjs');

function checkRelease() {
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--locked', '--no-deps', '--format-version', '1'], { encoding: 'utf8', windowsHide: true }));
  const members = metadata.packages.filter(pkg => metadata.workspace_members.includes(pkg.id));
  return validateVersions([read('package.json').version, read('package-lock.json').version,
    read('package-lock.json').packages[''].version, read('src-tauri/tauri.conf.json').version,
    ...members.map(pkg => pkg.version)], process.env.GITHUB_REF || '');
}
if (require.main === module) console.log(`Release versions verified: ${checkRelease()}`);
module.exports = { checkRelease };
