const { test } = require('node:test');
const assert = require('node:assert/strict');
const { guardHost, observeChild } = require('./hosted-preview-smoke.cjs');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');

const env = {
  GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'macOS',
  RUNNER_ARCH: 'ARM64', GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REPOSITORY: 'pulkitchandra1997/RepoDeck', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1',
  REPODECK_SMOKE_RUNNER: 'macos-15', REPODECK_HOSTED_SMOKE: 'preview3-disposable-only',
};
test('requires manual hosted macOS and the matching fixed runner architecture', () => {
  assert.equal(guardHost(env, 'darwin', 'arm64').arch, 'arm64');
  assert.equal(guardHost({ ...env, RUNNER_ARCH: 'X64', REPODECK_SMOKE_RUNNER: 'macos-15-intel' }, 'darwin', 'x64').arch, 'x86_64');
  for (const [key, value] of Object.entries({ GITHUB_ACTIONS: 'false', RUNNER_ENVIRONMENT: 'self-hosted', RUNNER_OS: 'Windows', GITHUB_EVENT_NAME: 'push', GITHUB_REPOSITORY: 'other/repo', REPODECK_HOSTED_SMOKE: '', REPODECK_SMOKE_RUNNER: 'macos-latest', RUNNER_ARCH: 'X64', GITHUB_RUN_ID: '' })) {
    assert.throws(() => guardHost({ ...env, [key]: value }, 'darwin', 'arm64'));
  }
  assert.throws(() => guardHost(env, 'win32', 'arm64'));
});
test('records exact early exit without signalling an exited process', async () => {
  const child = spawn(process.execPath, ['-e', 'process.stderr.write("fixture failure"); process.exit(7)']);
  const result = await observeChild(child, 3000, 1000);
  assert.equal(result.survived, false);
  assert.equal(result.exitCode, 7);
  assert.match(result.stderr, /fixture failure/);
  assert.deepEqual(result.signals, []);
});
test('observes survival and terminates only its child with bounded cleanup', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  const result = await observeChild(child, 200, 1000);
  assert.equal(result.survived, true);
  assert.equal(result.pid, child.pid);
  assert.deepEqual(result.signals, ['SIGTERM']);
  assert.equal(result.cleanupComplete, true);
});
test('records spawn failure as failure evidence', async () => {
  const result = await observeChild(spawn('repodeck-test-missing-executable-19', []), 200, 1000);
  assert.equal(result.survived, false);
  assert.match(result.spawnError, /ENOENT/);
});
test('escalates only the owned child and reports bounded cleanup failure', async () => {
  const child = new EventEmitter();
  child.pid = 123;
  const sent = [];
  child.kill = signal => { sent.push(signal); return true; };
  let unreferenced = false;
  child.unref = () => { unreferenced = true; };
  const result = await observeChild(child, 1, 1);
  assert.deepEqual(sent, ['SIGTERM', 'SIGKILL']);
  assert.equal(result.cleanupComplete, false);
  assert.equal(unreferenced, true);
});
test('stops escalation as soon as the owned child exits', async () => {
  const child = new EventEmitter();
  child.pid = 123;
  child.kill = signal => { child.emit('exit', null, signal); return true; };
  const result = await observeChild(child, 1, 1);
  assert.deepEqual(result.signals, ['SIGTERM']);
  assert.equal(result.cleanupComplete, true);
});
test('retains cleanup errors instead of losing owned-process evidence', async () => {
  const child = new EventEmitter();
  child.pid = 123;
  child.kill = () => { throw new Error('fixture permission denied'); };
  child.unref = () => {};
  const result = await observeChild(child, 1, 1);
  assert.equal(result.cleanupComplete, false);
  assert.match(result.cleanupErrors[0], /fixture permission denied/);
});
test('asynchronous kill errors without exit retain the live child and attempt both signals', async () => {
  const child = new EventEmitter();
  child.pid = 123;
  const sent = [];
  child.kill = signal => {
    sent.push(signal);
    queueMicrotask(() => child.emit('error', new Error(`failed ${signal}`)));
    return false;
  };
  child.unref = () => {};
  const result = await observeChild(child, 1, 1);
  assert.equal(result.cleanupComplete, false);
  assert.equal(result.spawnError, undefined);
  assert.deepEqual(sent, ['SIGTERM', 'SIGKILL']);
  assert.deepEqual(result.processErrors, ['failed SIGTERM', 'failed SIGKILL']);
});
test('pins both reviewed published asset hashes', () => {
  assert.equal(guardHost(env, 'darwin', 'arm64').sha256, 'b51bf924b871eb5ad1c26fa1202029faa9f6b7661827a6ad7165b26288360881');
  assert.equal(guardHost({ ...env, RUNNER_ARCH: 'X64', REPODECK_SMOKE_RUNNER: 'macos-15-intel' }, 'darwin', 'x64').sha256, '23d0220977dd7d73c13101906df38524c952968f623c0633a38edb00a2f0319a');
});
test('workflow exposes only manual dispatch with fixed hosted labels', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../../.github/workflows/hosted-preview3-smoke.yml'), 'utf8');
  assert.match(workflow, /on:\r?\n  workflow_dispatch:\r?\npermissions:/);
  assert.match(workflow, /os: \[macos-15, macos-15-intel\]/);
  assert.match(workflow, /runs-on: \$\{\{ matrix.os \}\}/);
  assert.doesNotMatch(workflow, /workflow_call:|pull_request:|push:|schedule:|self-hosted/);
  assert.match(workflow, /persist-credentials: false/);
});
