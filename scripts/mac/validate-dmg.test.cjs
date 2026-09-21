const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');

const {
  appleShortVersion,
  extractPlistXml,
  parseCliArguments,
  validateDmgDirectory,
} = require('./validate-dmg.cjs');

const expectedHash = '7abc42290786bcbb69e9caf8e1b551de57c0f926f124453e94a11612870b5219';
const noticesContent = '{"packages":[{"name":"fixture"}]}\n';
const noticesHash = createHash('sha256').update(noticesContent).digest('hex');

async function withDmgFixture(run) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'repodeck-dmg-test-'));
  const bundleDirectory = path.join(root, 'bundle');
  const evidenceFile = path.join(root, 'dmg-evidence.json');
  await fsp.mkdir(bundleDirectory);
  await fsp.writeFile(path.join(bundleDirectory, 'RepoDeck_0.1.0_macos_arm64.dmg'), 'fixture-dmg-bytes');
  try {
    await run({ root, bundleDirectory, evidenceFile });
  } finally {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('repodeck-dmg-test-'));
    await fsp.rm(root, { recursive: true, force: true });
  }
}

function nativeFixture({
  architecture = 'arm64',
  attachStatus = 0,
  attachMetadataStatus = 0,
  bundleVersion = '0.1.0',
  signatureStatus = 0,
  detachStatus = 0,
  externalDirectoryLink = false,
  bundledNotices,
  noticesSymlink = false,
  otoolStatus = 0,
} = {}) {
  const calls = [];
  const execute = (command, args, options = {}) => {
    calls.push({ command, args: [...args], input: options.input });
    if (command === 'sw_vers') {
      return { status: 0, stdout: 'ProductName:\tmacOS\nProductVersion:\t15.7\nBuildVersion:\t24G207\n', stderr: '' };
    }
    if (command === 'uname') return { status: 0, stdout: 'arm64\n', stderr: '' };
    if (command === 'hdiutil' && args[0] === 'imageinfo') {
      return { status: 0, stdout: 'Format Description: UDIF read-only compressed\n', stderr: '' };
    }
    if (command === 'hdiutil' && args[0] === 'verify') {
      return { status: 0, stdout: 'verified CRC32 $12345678\n', stderr: '' };
    }
    if (command === 'hdiutil' && args[0] === 'attach') {
      const mountPoint = args[args.indexOf('-mountpoint') + 1];
      const app = path.join(mountPoint, 'RepoDeck.app');
      const executable = path.join(app, 'Contents', 'MacOS', 'repodeck-desktop');
      const helper = path.join(app, 'Contents', 'Frameworks', 'libhelper.dylib');
      fs.mkdirSync(path.dirname(executable), { recursive: true });
      fs.mkdirSync(path.dirname(helper), { recursive: true });
      fs.mkdirSync(path.join(app, 'Contents', 'Resources'), { recursive: true });
      fs.writeFileSync(executable, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]));
      fs.chmodSync(executable, 0o755);
      fs.writeFileSync(helper, Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 1]));
      fs.writeFileSync(path.join(app, 'Contents', 'Resources', 'readme.txt'), 'fixture resource');
      fs.writeFileSync(path.join(app, 'Contents', 'Resources', 'Fixture.class'), Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 52]));
      fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), 'fixture plist');
      const notices = path.join(app, 'Contents', 'Resources', 'THIRD-PARTY-NOTICES.json');
      if (noticesSymlink) {
        const outsideNotices = path.join(path.dirname(mountPoint), 'outside-notices');
        fs.mkdirSync(outsideNotices);
        fs.symlinkSync(outsideNotices, notices, process.platform === 'win32' ? 'junction' : 'dir');
      } else if (bundledNotices !== undefined) {
        fs.writeFileSync(notices, bundledNotices);
      }
      if (externalDirectoryLink) {
        const outside = path.join(path.dirname(mountPoint), 'outside');
        fs.mkdirSync(outside);
        fs.writeFileSync(path.join(outside, 'external-mach-o'), Buffer.from([0xcf, 0xfa, 0xed, 0xfe]));
        fs.symlinkSync(outside, path.join(app, 'Contents', 'Resources', 'external'), process.platform === 'win32' ? 'junction' : 'dir');
      }
      return {
        status: attachStatus,
        stdout: `MIT License\nfixture agreement\n<?xml version="1.0"?><plist version="1.0"><dict/></plist>\n`,
        stderr: '',
      };
    }
    if (command === 'plutil' && args.at(-1) === '-') {
      if (attachMetadataStatus !== 0) {
        return { status: attachMetadataStatus, stdout: '', stderr: 'invalid attach metadata\n' };
      }
      assert.match(options.input, /^<\?xml version="1\.0"\?>/);
      assert.ok(!options.input.includes('MIT License'));
      const attach = calls.find(call => call.command === 'hdiutil' && call.args[0] === 'attach');
      const mountPoint = attach.args[attach.args.indexOf('-mountpoint') + 1];
      return { status: 0, stdout: JSON.stringify({
        'system-entities': [
          { 'dev-entry': '/dev/disk9' },
          { 'dev-entry': '/dev/disk9s1', 'mount-point': mountPoint },
        ],
      }), stderr: '' };
    }
    if (command === 'plutil') {
      return { status: 0, stdout: JSON.stringify({
        CFBundleExecutable: 'repodeck-desktop',
        CFBundleIdentifier: 'org.repodeck.desktop',
        CFBundleShortVersionString: bundleVersion,
      }), stderr: '' };
    }
    if (command === 'lipo') return { status: 0, stdout: `${architecture}\n`, stderr: '' };
    if (command === 'otool' && args[0] === '-L') {
      return otoolStatus === 0
        ? {
            status: 0,
            stdout: `${args[1]}:\n\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1351.0.0)\n`,
            stderr: '',
          }
        : { status: otoolStatus, stdout: '', stderr: 'otool inspection failed\n' };
    }
    if (command === 'codesign' && args[0] === '--verify') {
      return signatureStatus === 0
        ? { status: 0, stdout: '', stderr: 'RepoDeck.app: valid on disk\n' }
        : { status: signatureStatus, stdout: '', stderr: 'code object is not signed at all\n' };
    }
    if (command === 'codesign' && args[0] === '--display') {
      return signatureStatus === 0
        ? { status: 0, stdout: '', stderr: 'Signature=adhoc\nTeamIdentifier=not set\n' }
        : { status: signatureStatus, stdout: '', stderr: 'code object is not signed at all\n' };
    }
    if (command === 'hdiutil' && args[0] === 'detach') {
      return detachStatus === 0
        ? { status: 0, stdout: `\"${args[1]}\" ejected.\n`, stderr: '' }
        : { status: detachStatus, stdout: '', stderr: 'detach failed\n' };
    }
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
  };
  return { calls, execute };
}

test('retains deterministic recursive inventory and hash-bound otool evidence before upload', async () => {
  await withDmgFixture(async ({ bundleDirectory, evidenceFile }) => {
    const fixture = nativeFixture();
    const output = [];
    const result = await validateDmgDirectory({
      bundleDirectory,
      expectedVersion: '0.1.0',
      expectedArch: 'arm64',
      expectedSha256: expectedHash,
      signaturePolicy: 'ad-hoc',
      evidenceFile,
    }, { execute: fixture.execute, platform: 'darwin', writeOutput: value => output.push(value) });

    assert.equal(result.sha256, expectedHash);
    assert.equal(result.architecture, 'arm64');
    assert.equal(result.version, '0.1.0');
    assert.equal(result.signature, 'ad-hoc');
    assert.match(result.hostVersion, /ProductVersion:\t15\.7/);
    assert.equal(result.hostArchitecture, 'arm64');

    const evidence = JSON.parse(await fsp.readFile(evidenceFile, 'utf8'));
    assert.equal(evidence.schemaVersion, 1);
    assert.equal(evidence.dmgSha256, expectedHash);
    assert.equal(evidence.dmgFilename, 'RepoDeck_0.1.0_macos_arm64.dmg');
    assert.equal(evidence.architecture, 'arm64');
    assert.equal(evidence.version, '0.1.0');
    assert.equal(evidence.appPath, 'RepoDeck.app');
    assert.deepEqual(evidence.appInventory.map(entry => entry.path), [...evidence.appInventory.map(entry => entry.path)].sort());
    assert.match(
      evidence.appInventory.find(entry => entry.path === 'Contents/Resources/readme.txt').sha256,
      /^[0-9a-f]{64}$/,
    );
    assert.deepEqual(evidence.machOFiles.map(entry => entry.path), [
      'Contents/Frameworks/libhelper.dylib',
      'Contents/MacOS/repodeck-desktop',
    ]);
    for (const machO of evidence.machOFiles) {
      const inventoryEntry = evidence.appInventory.find(entry => entry.path === machO.path);
      assert.equal(machO.sha256, inventoryEntry.sha256);
      assert.match(machO.sha256, /^[0-9a-f]{64}$/);
      assert.ok(machO.otoolL.startsWith(`${machO.path}:\n`));
      assert.ok(!machO.otoolL.includes(path.dirname(evidenceFile)));
    }

    const dmg = path.resolve(bundleDirectory, 'RepoDeck_0.1.0_macos_arm64.dmg');
    const attach = fixture.calls.find(call => call.command === 'hdiutil' && call.args[0] === 'attach');
    const mountPoint = attach.args[attach.args.indexOf('-mountpoint') + 1];
    assert.equal(attach.input, 'Y\n');
    const app = path.join(mountPoint, 'RepoDeck.app');
    const executable = path.join(app, 'Contents', 'MacOS', 'repodeck-desktop');
    assert.deepEqual(fixture.calls.map(({ command, args }) => [command, args]), [
      ['sw_vers', []],
      ['uname', ['-m']],
      ['hdiutil', ['imageinfo', dmg]],
      ['hdiutil', ['verify', dmg]],
      ['hdiutil', ['attach', '-readonly', '-nobrowse', '-plist', '-mountpoint', mountPoint, dmg]],
      ['plutil', ['-convert', 'json', '-o', '-', '-']],
      ['plutil', ['-convert', 'json', '-o', '-', path.join(app, 'Contents', 'Info.plist')]],
      ['lipo', ['-archs', executable]],
      ['otool', ['-L', path.join(app, 'Contents', 'Frameworks', 'libhelper.dylib')]],
      ['otool', ['-L', executable]],
      ['codesign', ['--verify', '--deep', '--strict', '--verbose=4', app]],
      ['codesign', ['--display', '--verbose=4', app]],
      ['hdiutil', ['detach', '/dev/disk9s1']],
    ]);
    assert.ok(output.some(value => value.includes(expectedHash)));
  });
});

test('rejects a pinned hash mismatch before invoking native tools', async () => {
  await withDmgFixture(async ({ bundleDirectory, evidenceFile }) => {
    const fixture = nativeFixture();
    await assert.rejects(validateDmgDirectory({
      bundleDirectory,
      expectedVersion: '0.1.0',
      expectedArch: 'arm64',
      expectedSha256: '0'.repeat(64),
      signaturePolicy: 'observe',
      evidenceFile,
    }, { execute: fixture.execute, platform: 'darwin', writeOutput: () => {} }), /SHA-256 mismatch/);
    assert.deepEqual(fixture.calls, []);
  });
});

test('detaches the exact mounted device when bundle validation fails', async () => {
  await withDmgFixture(async ({ bundleDirectory, evidenceFile }) => {
    const fixture = nativeFixture({ architecture: 'x86_64' });
    await assert.rejects(validateDmgDirectory({
      bundleDirectory,
      expectedVersion: '0.1.0',
      expectedArch: 'arm64',
      signaturePolicy: 'required',
      evidenceFile,
    }, { execute: fixture.execute, platform: 'darwin', writeOutput: () => {} }), /architecture/);
    const detaches = fixture.calls.filter(call => call.command === 'hdiutil' && call.args[0] === 'detach');
    assert.deepEqual(detaches.map(call => call.args), [['detach', '/dev/disk9s1']]);
  });
});

test('fails closed when exact-device cleanup fails', async () => {
  await withDmgFixture(async ({ bundleDirectory, evidenceFile }) => {
    const fixture = nativeFixture({ detachStatus: 1 });
    await assert.rejects(validateDmgDirectory({
      bundleDirectory,
      expectedVersion: '0.1.0',
      expectedArch: 'arm64',
      signaturePolicy: 'required',
      evidenceFile,
    }, { execute: fixture.execute, platform: 'darwin', writeOutput: () => {} }), /detach.*\/dev\/disk9s1/i);
  });
});

test('failed attach cleans up only through the exact requested mountpoint', async () => {
  await withDmgFixture(async ({ bundleDirectory, evidenceFile }) => {
    const fixture = nativeFixture({ attachStatus: 1 });
    await assert.rejects(validateDmgDirectory({
      bundleDirectory,
      expectedVersion: '0.1.0',
      expectedArch: 'arm64',
      signaturePolicy: 'required',
      evidenceFile,
    }, { execute: fixture.execute, platform: 'darwin', writeOutput: () => {} }), /attach.*status 1/i);

    const attach = fixture.calls.find(call => call.command === 'hdiutil' && call.args[0] === 'attach');
    const requestedMountPoint = attach.args[attach.args.indexOf('-mountpoint') + 1];
    const detaches = fixture.calls.filter(call => call.command === 'hdiutil' && call.args[0] === 'detach');
    assert.deepEqual(detaches.map(call => call.args), [['detach', requestedMountPoint]]);
  });
});

test('invalid attach metadata falls back to the exact requested mountpoint', async () => {
  await withDmgFixture(async ({ bundleDirectory, evidenceFile }) => {
    const fixture = nativeFixture({ attachMetadataStatus: 1 });
    await assert.rejects(validateDmgDirectory({
      bundleDirectory,
      expectedVersion: '0.1.0',
      expectedArch: 'arm64',
      signaturePolicy: 'required',
      evidenceFile,
    }, { execute: fixture.execute, platform: 'darwin', writeOutput: () => {} }), /plutil.*status 1/i);

    const attach = fixture.calls.find(call => call.command === 'hdiutil' && call.args[0] === 'attach');
    const requestedMountPoint = attach.args[attach.args.indexOf('-mountpoint') + 1];
    const detaches = fixture.calls.filter(call => call.command === 'hdiutil' && call.args[0] === 'detach');
    assert.deepEqual(detaches.map(call => call.args), [['detach', requestedMountPoint]]);
  });
});

test('extracts one plist after displayed license text and rejects trailing data', () => {
  const xml = '<?xml version="1.0"?><plist version="1.0"><dict/></plist>';
  assert.equal(extractPlistXml(`MIT License\n${xml}\n`, 'attach metadata'), xml);
  assert.throws(() => extractPlistXml(`MIT License\n${xml}\nunexpected`, 'attach metadata'));
  assert.throws(() => extractPlistXml('MIT License only', 'attach metadata'));
});

test('derives only the expected Apple short version and still checks actual bundle metadata', async () => {
  assert.equal(appleShortVersion('0.1.1-preview.1'), '0.1.1');
  assert.throws(() => appleShortVersion('not-a-version'));

  await withDmgFixture(async ({ bundleDirectory, evidenceFile }) => {
    const fixture = nativeFixture({ bundleVersion: '0.1.1-preview.1' });
    await assert.rejects(validateDmgDirectory({
      bundleDirectory,
      expectedVersion: appleShortVersion('0.1.1-preview.1'),
      expectedArch: 'arm64',
      signaturePolicy: 'required',
      evidenceFile,
    }, { execute: fixture.execute, platform: 'darwin', writeOutput: () => {} }), /Unexpected bundle version/);
    const detaches = fixture.calls.filter(call => call.command === 'hdiutil' && call.args[0] === 'detach');
    assert.deepEqual(detaches.map(call => call.args), [['detach', '/dev/disk9s1']]);
  });
});

test('observe mode records an unsigned published bundle without executing it', async () => {
  await withDmgFixture(async ({ bundleDirectory, evidenceFile }) => {
    const fixture = nativeFixture({ signatureStatus: 1 });
    const result = await validateDmgDirectory({
      bundleDirectory,
      expectedVersion: '0.1.0',
      expectedArch: 'arm64',
      expectedSha256: expectedHash,
      signaturePolicy: 'observe',
      evidenceFile,
    }, { execute: fixture.execute, platform: 'darwin', writeOutput: () => {} });
    assert.equal(result.signature, 'invalid-or-unsigned');
    assert.ok(fixture.calls.some(call => call.command === 'codesign' && call.args[0] === '--verify'));
    assert.ok(fixture.calls.every(call => call.command !== path.join('RepoDeck.app', 'Contents', 'MacOS', 'repodeck-desktop')));
  });
});

test('records an external directory symlink without following its contents', async () => {
  await withDmgFixture(async ({ bundleDirectory, evidenceFile }) => {
    const fixture = nativeFixture({ externalDirectoryLink: true });
    await validateDmgDirectory({
      bundleDirectory,
      expectedVersion: '0.1.0',
      expectedArch: 'arm64',
      expectedSha256: expectedHash,
      signaturePolicy: 'ad-hoc',
      evidenceFile,
    }, { execute: fixture.execute, platform: 'darwin', writeOutput: () => {} });

    const evidence = JSON.parse(await fsp.readFile(evidenceFile, 'utf8'));
    const link = evidence.appInventory.find(entry => entry.path === 'Contents/Resources/external');
    assert.equal(link.type, 'symlink');
    assert.equal(link.targetScope, 'outside-bundle');
    assert.ok(!evidence.appInventory.some(entry => entry.path.includes('external-mach-o')));
    assert.ok(!fixture.calls.some(call => call.command === 'otool' && call.args[1]?.includes('outside')));
  });
});

test('fails closed, detaches, and retains no evidence when otool inspection fails', async () => {
  await withDmgFixture(async ({ bundleDirectory, evidenceFile }) => {
    const fixture = nativeFixture({ otoolStatus: 1 });
    await assert.rejects(validateDmgDirectory({
      bundleDirectory,
      expectedVersion: '0.1.0',
      expectedArch: 'arm64',
      signaturePolicy: 'required',
      evidenceFile,
    }, { execute: fixture.execute, platform: 'darwin', writeOutput: () => {} }), /otool.*failed with status 1/i);
    assert.deepEqual(
      fixture.calls.filter(call => call.command === 'hdiutil' && call.args[0] === 'detach').map(call => call.args),
      [['detach', '/dev/disk9s1']],
    );
    await assert.rejects(fsp.access(evidenceFile));
  });
});

test('requires exact bundled notice bytes when a notice hash is supplied', async () => {
  await withDmgFixture(async ({ bundleDirectory, evidenceFile }) => {
    const fixture = nativeFixture({ bundledNotices: noticesContent });
    const result = await validateDmgDirectory({
      bundleDirectory,
      expectedVersion: '0.1.0',
      expectedArch: 'arm64',
      expectedNoticesSha256: noticesHash,
      signaturePolicy: 'ad-hoc',
      evidenceFile,
    }, { execute: fixture.execute, platform: 'darwin', writeOutput: () => {} });

    const notice = result.appInventory.find(entry => entry.path === 'Contents/Resources/THIRD-PARTY-NOTICES.json');
    assert.deepEqual(notice, {
      path: 'Contents/Resources/THIRD-PARTY-NOTICES.json',
      sha256: noticesHash,
      size: Buffer.byteLength(noticesContent),
      type: 'file',
    });
  });
});

for (const scenario of [
  {
    name: 'missing',
    fixture: {},
    pattern: /required bundled notices are missing/i,
  },
  {
    name: 'mismatched',
    fixture: { bundledNotices: '{"packages":[]}\n' },
    pattern: /bundled notices SHA-256 mismatch/i,
  },
  {
    name: 'symlinked',
    fixture: { noticesSymlink: true },
    pattern: /bundled notices must be a regular file/i,
  },
]) {
  test(`fails closed for ${scenario.name} bundled notices`, async () => {
    await withDmgFixture(async ({ bundleDirectory, evidenceFile }) => {
      const fixture = nativeFixture(scenario.fixture);
      await assert.rejects(validateDmgDirectory({
        bundleDirectory,
        expectedVersion: '0.1.0',
        expectedArch: 'arm64',
        expectedNoticesSha256: noticesHash,
        signaturePolicy: 'ad-hoc',
        evidenceFile,
      }, { execute: fixture.execute, platform: 'darwin', writeOutput: () => {} }), scenario.pattern);
      assert.deepEqual(
        fixture.calls.filter(call => call.command === 'hdiutil' && call.args[0] === 'detach').map(call => call.args),
        [['detach', '/dev/disk9s1']],
      );
      await assert.rejects(fsp.access(evidenceFile));
    });
  });
}

test('CLI arguments are strict and keep published hash and signature policy explicit', () => {
  assert.deepEqual(parseCliArguments([
    '--directory', '/tmp/release', '--version', '0.1.0', '--arch', 'x86_64',
    '--sha256', 'c0b7036b6e0d1e8cd45e306ea35230e48a65f2961af9b3d21b0cc7f8fbe2576b',
    '--signature', 'observe',
    '--evidence', '/tmp/evidence.json',
  ]), {
    bundleDirectory: '/tmp/release',
    expectedVersion: '0.1.0',
    expectedArch: 'x86_64',
    expectedSha256: 'c0b7036b6e0d1e8cd45e306ea35230e48a65f2961af9b3d21b0cc7f8fbe2576b',
    signaturePolicy: 'observe',
    evidenceFile: '/tmp/evidence.json',
  });
  assert.equal(parseCliArguments([
    '--directory', '/tmp/release', '--version', '0.1.0', '--arch', 'arm64',
    '--evidence', '/tmp/evidence.json', '--notices-sha256', noticesHash,
  ]).expectedNoticesSha256, noticesHash);
  assert.throws(() => parseCliArguments([]), /name\/value/);
  assert.throws(() => parseCliArguments([
    '--directory', '/tmp/release', '--version', '0.1.0', '--arch', 'arm64',
  ]), /--evidence is required/);
  for (const args of [
    ['--directory', '/tmp/release', '--version', '0.1.1-preview.1', '--arch', 'arm64', '--evidence', '/tmp/evidence.json'],
    ['--directory', '/tmp/release', '--version', '0.1.0', '--arch', 'other', '--evidence', '/tmp/evidence.json'],
    ['--directory', '/tmp/release', '--version', '0.1.0', '--arch', 'arm64', '--signature', 'skip', '--evidence', '/tmp/evidence.json'],
    ['--directory', '/tmp/release', '--version', '0.1.0', '--arch', 'arm64', '--unknown', 'value', '--evidence', '/tmp/evidence.json'],
    ['--directory', '/tmp/release', '--version', '0.1.0', '--arch', 'arm64', '--evidence', '/tmp/evidence.json', '--notices-sha256', noticesHash.toUpperCase()],
  ]) assert.throws(() => parseCliArguments(args));
});
