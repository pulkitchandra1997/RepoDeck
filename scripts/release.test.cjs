const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateVersions, assetName } = require('./release-lib.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { stageRelease } = require('./stage-release.cjs');
const { spawnSync } = require('node:child_process');

test('notice packaging command selects strict collection and maps the fresh artifact', async () => {
  const manifest = JSON.parse(await fs.readFile('package.json', 'utf8'));
  const base = JSON.parse(await fs.readFile('src-tauri/tauri.conf.json', 'utf8'));
  const notices = JSON.parse(await fs.readFile('src-tauri/tauri.notices.conf.json', 'utf8'));
  assert.equal(manifest.scripts['package:notices'],
    'tauri build --config src-tauri/tauri.notices.conf.json');
  assert.equal(base.build.beforeBuildCommand, 'npm run build');
  assert.equal(notices.build.beforeBuildCommand,
    'node scripts/generate-notices.cjs --bundle && npm run build');
  assert.deepEqual(notices.bundle.resources,
    { '../.tools/notices/THIRD-PARTY-NOTICES.json': 'THIRD-PARTY-NOTICES.json' });
});

test('desktop packaging fetches the complete notice union and verifies bundled resources', async () => {
  const workflow = await fs.readFile('.github/workflows/verify.yml', 'utf8');
  assert.match(workflow, /^\s*cargo fetch --locked\s*$/m);
  for (const target of targets) {
    assert.match(workflow, new RegExp(`cargo fetch --locked --target ${target}`));
  }
  assert.doesNotMatch(workflow, /npx tauri build --target/);
  assert.match(workflow, /npm run package:notices -- --target/);
  assert.match(workflow, /7z[^\r\n]* x /i);
  assert.match(workflow, /verify-nsis-notices\.cjs/);
  assert.match(workflow, /ICON_SHA256=.*src-tauri\/icons\/icon\.icns/);
  assert.match(workflow, /--icon-sha256 "\$ICON_SHA256"/);
  assert.match(workflow, /--notices-sha256/);
});

test('preview 3 notes disclose the complete repair scope since public v0.1.0', async () => {
  const notes = JSON.parse(await fs.readFile('docs/releases/versions/0.1.1-preview.3.json', 'utf8'));
  assert.ok(notes.fixes.some(fix => /native application icon/i.test(fix)));
  assert.ok(notes.features.some(feature => /since.*v0\.1\.0.*Copilot instructions/i.test(feature)));
  assert.ok(notes.fixes.some(fix => /since.*v0\.1\.0.*saved settings/i.test(fix)));
  assert.ok(notes.fixes.some(fix => /since.*v0\.1\.0.*padded searches/i.test(fix)));
  assert.ok(notes.fixes.some(fix => /since.*v0\.1\.0.*numeric Apple bundle versions.*ad-hoc.*native disk-image/i.test(fix)));
});

test('macOS bundle metadata uses the numeric release version without a preview suffix', async () => {
  const config = JSON.parse(await fs.readFile('src-tauri/tauri.conf.json', 'utf8'));
  const version = require('semver').parse(config.version);
  assert.ok(version);
  const numeric = `${version.major}.${version.minor}.${version.patch}`;
  assert.equal(config.bundle.macOS.bundleVersion, numeric);
  assert.equal(config.bundle.macOS.infoPlist, 'Info.plist');
  const plist = await fs.readFile('src-tauri/Info.plist', 'utf8');
  assert.equal(plist.replaceAll('\r\n', '\n'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleShortVersionString</key>
  <string>${numeric}</string>
</dict>
</plist>
`);
});

test('preview policy CLI fails closed with a useful diagnostic outside a release environment', () => {
  const result = spawnSync(process.execPath, ['scripts/check-release.cjs', '--preview-policy'], {
    encoding: 'utf8', windowsHide: true,
    env: { ...process.env, GITHUB_REF: '', GITHUB_SHA: '', GITHUB_REPOSITORY: '' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unsigned preview requires|ENOENT|Unexpected release repository/);
  assert.doesNotMatch(result.stderr, /ERR_INVALID_ARG_TYPE|circular dependency/);
});

const previewVersion = '0.2.0-preview.1';
const previewCommit = 'a'.repeat(40);
const targets = ['x86_64-pc-windows-msvc', 'aarch64-apple-darwin', 'x86_64-apple-darwin'];
const previewData = () => ({
  version: previewVersion, channel: 'unsigned-preview',
  features: ['Inspect local repositories.'], fixes: ['Handle refresh errors.'],
  limitations: ['Installer lifecycle checks remain pending.'],
});

test('preview notes require bounded explicit version data and safe text', () => {
  const { validatePreviewNotes } = require('./generate-release-notes.cjs');
  assert.deepEqual(validatePreviewNotes(previewData(), previewVersion), previewData());
  for (const change of [
    { version: '0.2.0' }, { channel: 'stable' }, { extra: true },
    { features: [] }, { fixes: [''] }, { limitations: [] },
    { features: ['x'.repeat(501)] }, { features: Array(21).fill('Feature') },
    { features: ['[download](https://evil.example)'] }, { features: ['<details>'] },
    { features: ['line\nbreak'] }, { features: ['hidden\u202e'] },
  ]) assert.throws(() => validatePreviewNotes({ ...previewData(), ...change }, previewVersion));
  assert.throws(() => validatePreviewNotes(previewData(), '../unsafe'));
  assert.throws(() => validatePreviewNotes({ ...previewData(), version: '0.2.0' }, '0.2.0'));
});

test('preview source must be an exact merged PR commit to this repository main', () => {
  const { validatePreviewSource } = require('./check-release.cjs');
  const pr = { merged_at: '2026-09-15T00:00:00Z', merge_commit_sha: previewCommit,
    base: { ref: 'main', repo: { full_name: 'pulkitchandra1997/RepoDeck' } } };
  assert.doesNotThrow(() => validatePreviewSource(previewCommit, previewCommit, [pr]));
  for (const prs of [[], [{ ...pr, merged_at: null }], [{ ...pr, merge_commit_sha: 'b'.repeat(40) }],
    [{ ...pr, base: { ...pr.base, ref: 'other' } }],
    [{ ...pr, base: { ref: 'main', repo: { full_name: 'other/RepoDeck' } } }]]) {
    assert.throws(() => validatePreviewSource(previewCommit, previewCommit, prs), /merged PR/);
  }
  assert.throws(() => validatePreviewSource(previewCommit, 'b'.repeat(40), [pr]), /source/);
  assert.throws(() => validatePreviewSource('bad', 'bad', [pr]), /SHA/);
});

test('preview preflight rejects existing drafts, published releases and API or ancestry errors', () => {
  const { verifyPreviewSource } = require('./check-release.cjs');
  const env = { GITHUB_REPOSITORY: 'pulkitchandra1997/RepoDeck',
    GITHUB_REF: `refs/tags/v${previewVersion}`, GITHUB_SHA: previewCommit };
  const pr = { merged_at: '2026-09-15', merge_commit_sha: previewCommit,
    base: { ref: 'main', repo: { full_name: env.GITHUB_REPOSITORY } } };
  let releases = [], failure = '', remoteSha = previewCommit;
  const commands = [];
  const run = (command, args) => {
    commands.push([command, args]);
    if (args.join(' ').includes(failure) && failure) throw new Error('authority unavailable');
    if (command === 'git') {
      if (args[0] === 'merge-base') return '';
      if (args[0] === 'ls-remote') return `${remoteSha}\trefs/tags/v${previewVersion}`;
      return previewCommit;
    }
    return JSON.stringify([args.at(-1).includes('/pulls?') ? [pr] : releases]);
  };
  assert.equal(verifyPreviewSource(previewVersion, env, run), previewCommit);
  assert.ok(commands.some(([command, args]) => command === 'git' && args[0] === 'merge-base'));
  for (const draft of [true, false]) {
    releases = [{ tag_name: `v${previewVersion}`, draft }];
    assert.throws(() => verifyPreviewSource(previewVersion, env, run), /already exists/);
  }
  releases = [];
  for (failure of ['merge-base', '/pulls?', '/releases?', 'ls-remote']) {
    assert.throws(() => verifyPreviewSource(previewVersion, env, run), /authority unavailable/);
  }
  failure = '';
  remoteSha = 'b'.repeat(40);
  assert.throws(() => verifyPreviewSource(previewVersion, env, run), /remote tag/);
  for (const change of [{ GITHUB_REPOSITORY: 'other/repo' }, { GITHUB_REF: 'refs/heads/main' }, { GITHUB_SHA: '--bad' }]) {
    assert.throws(() => verifyPreviewSource(previewVersion, { ...env, ...change }, run));
  }
  assert.throws(() => verifyPreviewSource('0.2.0', env, run), /preview/);
});

test('staging rejects linked bundle roots without following them', async () => {
  await withPreviewAssets(async assets => {
    const root = path.dirname(assets);
    const link = path.join(root, 'linked-bundle');
    await fs.symlink(path.join(root, targets[0]), link, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(stageRelease(link, path.join(root, 'output'), previewVersion, targets[0], previewCommit), /real directory/);
  });
});

test('release assembly rejects linked target directories and empty installers', async () => {
  const { verifyReleaseAssets } = require('./check-release.cjs');
  await withPreviewAssets(async assets => {
    const directory = path.join(assets, `release-${targets[0]}`);
    const moved = path.join(path.dirname(assets), 'moved-target');
    await fs.rename(directory, moved);
    await fs.symlink(moved, directory, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(verifyReleaseAssets(assets, previewVersion, previewCommit), /directories/);
    await fs.unlink(directory);
    await fs.rename(moved, directory);
    await fs.writeFile(path.join(directory, assetName(previewVersion, targets[0])), '');
    await assert.rejects(verifyReleaseAssets(assets, previewVersion, previewCommit), /nonempty/);
  });
});

async function withPreviewAssets(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repodeck-release-test-'));
  try {
    const assets = path.join(root, 'assets');
    for (const target of targets) {
      const bundle = path.join(root, target);
      await fs.mkdir(bundle);
      await fs.writeFile(path.join(bundle, target.includes('windows') ? 'fixture.exe' : 'fixture.dmg'), target);
      await stageRelease(bundle, path.join(assets, `release-${target}`), previewVersion, target, previewCommit);
    }
    await run(assets);
  } finally {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('repodeck-release-test-'));
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('release assembly verifies all targets and generates three prominent exact installer links', async () => {
  const { verifyReleaseAssets } = require('./check-release.cjs');
  const { generateReleaseNotes } = require('./generate-release-notes.cjs');
  await withPreviewAssets(async assets => {
    const manifests = await verifyReleaseAssets(assets, previewVersion, previewCommit);
    assert.equal(manifests.length, 3);
    const notes = generateReleaseNotes(previewData(), previewVersion, previewCommit, manifests);
    assert.equal(notes, generateReleaseNotes(previewData(), previewVersion, previewCommit, manifests));
    const prominent = notes.split('<details>')[0];
    for (const target of targets) assert.ok(prominent.includes(`https://github.com/pulkitchandra1997/RepoDeck/releases/download/v${previewVersion}/${assetName(previewVersion, target)}`));
    for (const heading of ['## Features', '## Fixes', '## Known Limitations']) assert.ok(prominent.includes(heading));
    assert.match(notes, /unsigned/);
    assert.match(notes, /Automatic updates are not implemented/);
    assert.match(notes, /<summary>Source, checksums and verification<\/summary>/);
    assert.ok(notes.includes(previewCommit));
    assert.throws(() => generateReleaseNotes(previewData(), previewVersion, previewCommit, manifests.slice(1)));
  });
});

test('release assembly rejects missing targets, unexpected files and altered metadata or bytes', async () => {
  const { verifyReleaseAssets } = require('./check-release.cjs');
  await withPreviewAssets(async assets => {
    const verify = () => verifyReleaseAssets(assets, previewVersion, previewCommit);
    const directory = path.join(assets, `release-${targets[0]}`);
    const name = assetName(previewVersion, targets[0]);
    const manifestPath = path.join(directory, `${name}.json`);
    const original = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    for (const change of [{ commit: 'b'.repeat(40) }, { version: '0.9.0' }, { target: targets[1] },
      { file: '../escape.exe' }, { sha256: '0'.repeat(64) }, { signing: 'signed' }, { extra: true }]) {
      await fs.writeFile(manifestPath, JSON.stringify({ ...original, ...change }));
      await assert.rejects(verify());
    }
    await fs.writeFile(manifestPath, JSON.stringify(original));
    const checksumPath = path.join(directory, `${name}.sha256`);
    const checksum = await fs.readFile(checksumPath);
    await fs.writeFile(checksumPath, `${original.sha256}  ../escape.exe\n`);
    await assert.rejects(verify(), /checksum/);
    await fs.writeFile(checksumPath, checksum);
    await fs.appendFile(path.join(directory, name), 'tampered');
    await assert.rejects(verify(), /digest/);
    await fs.writeFile(path.join(directory, name), targets[0]);
    await fs.writeFile(path.join(directory, 'extra.exe'), 'extra');
    await assert.rejects(verify(), /files/);
    await fs.unlink(path.join(directory, 'extra.exe'));
    await fs.rename(directory, `${directory}-missing`);
    await assert.rejects(verify(), /targets/);
  });
});

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
