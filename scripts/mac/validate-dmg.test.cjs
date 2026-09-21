const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  appleShortVersion,
  extractPlistXml,
  parseCliArguments,
  validateDmgDirectory,
} = require('./validate-dmg.cjs');

const expectedHash = '7abc42290786bcbb69e9caf8e1b551de57c0f926f124453e94a11612870b5219';

async function withDmgFixture(run) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'repodeck-dmg-test-'));
  const bundleDirectory = path.join(root, 'bundle');
  await fsp.mkdir(bundleDirectory);
  await fsp.writeFile(path.join(bundleDirectory, 'RepoDeck_0.1.0_macos_arm64.dmg'), 'fixture-dmg-bytes');
  try {
    await run({ root, bundleDirectory });
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
      fs.mkdirSync(path.dirname(executable), { recursive: true });
      fs.writeFileSync(executable, 'not executed');
      fs.chmodSync(executable, 0o755);
      fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), 'fixture plist');
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

test('validates a DMG with bounded native commands and detaches the exact mounted device', async () => {
  await withDmgFixture(async ({ bundleDirectory }) => {
    const fixture = nativeFixture();
    const output = [];
    const result = await validateDmgDirectory({
      bundleDirectory,
      expectedVersion: '0.1.0',
      expectedArch: 'arm64',
      expectedSha256: expectedHash,
      signaturePolicy: 'ad-hoc',
    }, { execute: fixture.execute, platform: 'darwin', writeOutput: value => output.push(value) });

    assert.equal(result.sha256, expectedHash);
    assert.equal(result.architecture, 'arm64');
    assert.equal(result.version, '0.1.0');
    assert.equal(result.signature, 'ad-hoc');
    assert.match(result.hostVersion, /ProductVersion:\t15\.7/);
    assert.equal(result.hostArchitecture, 'arm64');

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
      ['codesign', ['--verify', '--deep', '--strict', '--verbose=4', app]],
      ['codesign', ['--display', '--verbose=4', app]],
      ['hdiutil', ['detach', '/dev/disk9s1']],
    ]);
    assert.ok(output.some(value => value.includes(expectedHash)));
  });
});

test('rejects a pinned hash mismatch before invoking native tools', async () => {
  await withDmgFixture(async ({ bundleDirectory }) => {
    const fixture = nativeFixture();
    await assert.rejects(validateDmgDirectory({
      bundleDirectory,
      expectedVersion: '0.1.0',
      expectedArch: 'arm64',
      expectedSha256: '0'.repeat(64),
      signaturePolicy: 'observe',
    }, { execute: fixture.execute, platform: 'darwin', writeOutput: () => {} }), /SHA-256 mismatch/);
    assert.deepEqual(fixture.calls, []);
  });
});

test('detaches the exact mounted device when bundle validation fails', async () => {
  await withDmgFixture(async ({ bundleDirectory }) => {
    const fixture = nativeFixture({ architecture: 'x86_64' });
    await assert.rejects(validateDmgDirectory({
      bundleDirectory,
      expectedVersion: '0.1.0',
      expectedArch: 'arm64',
      signaturePolicy: 'required',
    }, { execute: fixture.execute, platform: 'darwin', writeOutput: () => {} }), /architecture/);
    const detaches = fixture.calls.filter(call => call.command === 'hdiutil' && call.args[0] === 'detach');
    assert.deepEqual(detaches.map(call => call.args), [['detach', '/dev/disk9s1']]);
  });
});

test('fails closed when exact-device cleanup fails', async () => {
  await withDmgFixture(async ({ bundleDirectory }) => {
    const fixture = nativeFixture({ detachStatus: 1 });
    await assert.rejects(validateDmgDirectory({
      bundleDirectory,
      expectedVersion: '0.1.0',
      expectedArch: 'arm64',
      signaturePolicy: 'required',
    }, { execute: fixture.execute, platform: 'darwin', writeOutput: () => {} }), /detach.*\/dev\/disk9s1/i);
  });
});

test('failed attach cleans up only through the exact requested mountpoint', async () => {
  await withDmgFixture(async ({ bundleDirectory }) => {
    const fixture = nativeFixture({ attachStatus: 1 });
    await assert.rejects(validateDmgDirectory({
      bundleDirectory,
      expectedVersion: '0.1.0',
      expectedArch: 'arm64',
      signaturePolicy: 'required',
    }, { execute: fixture.execute, platform: 'darwin', writeOutput: () => {} }), /attach.*status 1/i);

    const attach = fixture.calls.find(call => call.command === 'hdiutil' && call.args[0] === 'attach');
    const requestedMountPoint = attach.args[attach.args.indexOf('-mountpoint') + 1];
    const detaches = fixture.calls.filter(call => call.command === 'hdiutil' && call.args[0] === 'detach');
    assert.deepEqual(detaches.map(call => call.args), [['detach', requestedMountPoint]]);
  });
});

test('invalid attach metadata falls back to the exact requested mountpoint', async () => {
  await withDmgFixture(async ({ bundleDirectory }) => {
    const fixture = nativeFixture({ attachMetadataStatus: 1 });
    await assert.rejects(validateDmgDirectory({
      bundleDirectory,
      expectedVersion: '0.1.0',
      expectedArch: 'arm64',
      signaturePolicy: 'required',
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

  await withDmgFixture(async ({ bundleDirectory }) => {
    const fixture = nativeFixture({ bundleVersion: '0.1.1-preview.1' });
    await assert.rejects(validateDmgDirectory({
      bundleDirectory,
      expectedVersion: appleShortVersion('0.1.1-preview.1'),
      expectedArch: 'arm64',
      signaturePolicy: 'required',
    }, { execute: fixture.execute, platform: 'darwin', writeOutput: () => {} }), /Unexpected bundle version/);
    const detaches = fixture.calls.filter(call => call.command === 'hdiutil' && call.args[0] === 'detach');
    assert.deepEqual(detaches.map(call => call.args), [['detach', '/dev/disk9s1']]);
  });
});

test('observe mode records an unsigned published bundle without executing it', async () => {
  await withDmgFixture(async ({ bundleDirectory }) => {
    const fixture = nativeFixture({ signatureStatus: 1 });
    const result = await validateDmgDirectory({
      bundleDirectory,
      expectedVersion: '0.1.0',
      expectedArch: 'arm64',
      expectedSha256: expectedHash,
      signaturePolicy: 'observe',
    }, { execute: fixture.execute, platform: 'darwin', writeOutput: () => {} });
    assert.equal(result.signature, 'invalid-or-unsigned');
    assert.ok(fixture.calls.some(call => call.command === 'codesign' && call.args[0] === '--verify'));
    assert.ok(fixture.calls.every(call => call.command !== path.join('RepoDeck.app', 'Contents', 'MacOS', 'repodeck-desktop')));
  });
});

test('CLI arguments are strict and keep published hash and signature policy explicit', () => {
  assert.deepEqual(parseCliArguments([
    '--directory', '/tmp/release', '--version', '0.1.0', '--arch', 'x86_64',
    '--sha256', 'c0b7036b6e0d1e8cd45e306ea35230e48a65f2961af9b3d21b0cc7f8fbe2576b',
    '--signature', 'observe',
  ]), {
    bundleDirectory: '/tmp/release',
    expectedVersion: '0.1.0',
    expectedArch: 'x86_64',
    expectedSha256: 'c0b7036b6e0d1e8cd45e306ea35230e48a65f2961af9b3d21b0cc7f8fbe2576b',
    signaturePolicy: 'observe',
  });
  for (const args of [
    [],
    ['--directory', '/tmp/release', '--version', '0.1.1-preview.1', '--arch', 'arm64'],
    ['--directory', '/tmp/release', '--version', '0.1.0', '--arch', 'other'],
    ['--directory', '/tmp/release', '--version', '0.1.0', '--arch', 'arm64', '--signature', 'skip'],
    ['--directory', '/tmp/release', '--version', '0.1.0', '--arch', 'arm64', '--unknown', 'value'],
  ]) assert.throws(() => parseCliArguments(args));
});
