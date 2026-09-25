const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const targets = {
  arm64: { runner: 'macos-15', runnerArch: 'ARM64', arch: 'arm64', suffix: 'arm64', sha256: 'b51bf924b871eb5ad1c26fa1202029faa9f6b7661827a6ad7165b26288360881' },
  x64: { runner: 'macos-15-intel', runnerArch: 'X64', arch: 'x86_64', suffix: 'x64', sha256: '23d0220977dd7d73c13101906df38524c952968f623c0633a38edb00a2f0319a' },
};

function guardHost(env, platform = process.platform, arch = process.arch) {
  assert.equal(platform, 'darwin', 'Hosted smoke requires macOS');
  for (const [key, value] of Object.entries({ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'macOS', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: 'pulkitchandra1997/RepoDeck', REPODECK_HOSTED_SMOKE: 'preview3-disposable-only' })) {
    assert.equal(env[key], value, `Refusing native execution: ${key}`);
  }
  const target = targets[arch];
  assert.ok(target, 'Unsupported native architecture');
  assert.equal(env.REPODECK_SMOKE_RUNNER, target.runner, 'Unexpected runner label');
  assert.equal(env.RUNNER_ARCH, target.runnerArch, 'Runner architecture mismatch');
  assert.match(env.GITHUB_RUN_ID || '', /^\d+$/, 'Missing run ID');
  assert.match(env.GITHUB_RUN_ATTEMPT || '', /^\d+$/, 'Missing run attempt');
  return target;
}

async function observeChild(child, duration = 15000, grace = 5000) {
  const result = { pid: child.pid ?? null, survived: false, exitCode: null, signal: null, signals: [], stdout: '', stderr: '', cleanupComplete: false };
  let exited = false;
  let spawned = Number.isInteger(child.pid) && child.pid > 0;
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  child.stdout?.on('data', chunk => { result.stdout = (result.stdout + chunk).slice(-65536); });
  child.stderr?.on('data', chunk => { result.stderr = (result.stderr + chunk).slice(-65536); });
  child.once('spawn', () => { spawned = true; result.pid = child.pid; });
  child.on('error', error => {
    if (!spawned && child.pid == null) {
      result.spawnError = error.message;
      exited = true; // No process was created, so there is nothing to terminate.
      finish();
    } else {
      (result.processErrors ||= []).push(error.message);
    }
  });
  child.once('exit', (code, signal) => { result.exitCode = code; result.signal = signal; exited = true; finish(); });
  const wait = async ms => {
    let timer;
    await Promise.race([done, new Promise(resolve => { timer = setTimeout(resolve, ms); })]);
    clearTimeout(timer);
  };
  await wait(duration);
  result.survived = !exited;
  // ChildProcess retains ownership; never look up or signal a PID by process name.
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    if (exited) break;
    result.signals.push(signal);
    try { child.kill(signal); }
    catch (error) { (result.cleanupErrors ||= []).push(`${signal}: ${error.message}`); }
    await wait(grace);
  }
  result.cleanupComplete = exited;
  child.stdout?.destroy();
  child.stderr?.destroy();
  if (!exited) child.unref();
  return result;
}

async function main() {
  const target = guardHost(process.env);
  const temp = await fs.realpath(process.env.RUNNER_TEMP);
  assert.ok(path.isAbsolute(temp), 'Runner temp must be absolute');
  const root = await fs.mkdtemp(path.join(temp, 'repodeck-preview3-smoke-'));
  const evidenceDirectory = path.resolve('.tools/hosted-preview3-evidence');
  await fs.mkdir(evidenceDirectory, { recursive: true });
  const evidenceFile = path.join(evidenceDirectory, `smoke-${target.arch}.json`);
  const evidence = {
    schemaVersion: 1, version: '0.1.1-preview.3', target,
    releaseSourceSha: 'bbf7490b518139d138f5656291724f51b9a97550',
    run: { id: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, harnessSha: process.env.GITHUB_SHA, url: `https://github.com/pulkitchandra1997/RepoDeck/actions/runs/${process.env.GITHUB_RUN_ID}` },
    startedAt: new Date().toISOString(), commands: [], outcome: 'failed',
    pending: ['Real browser download quarantine and Gatekeeper', 'Finder/LaunchServices first launch', 'Interactive GUI functionality, Git present/missing and repository folder permissions', 'Copy to /Applications, settings retention, upgrade, reopen and full removal lifecycle'],
    limitations: 'curl may omit browser quarantine. Direct bundle executable survival is not GUI readiness or full lifecycle coverage. This smoke cannot close issue 19.',
  };
  const run = (command, args, options = {}) => {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024, input: options.input });
    const record = { command, args, status: result.status, signal: result.signal, stdout: (result.stdout || '').slice(-65536), stderr: (result.stderr || '').slice(-65536), error: result.error?.message };
    evidence.commands.push(record);
    if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message || record.stderr || `exit ${result.status}`}`);
    return record.stdout;
  };
  const mount = path.join(root, 'mount');
  let attachAttempted = false;
  let detached = false;
  try {
    evidence.os = run('/usr/bin/sw_vers', []);
    evidence.arch = run('/usr/bin/uname', ['-m']).trim();
    assert.equal(evidence.arch, target.arch, 'Native host mismatch');
    // A GUI bootstrap domain is a prerequisite, not proof a window can be used.
    run('/bin/launchctl', ['print', `gui/${process.getuid()}`]);
    evidence.guiBootstrapAvailable = true;
    const downloads = path.join(root, 'downloads');
    await fs.mkdir(downloads);
    const dmg = path.join(downloads, `RepoDeck_0.1.1-preview.3_macos_${target.suffix}.dmg`);
    run('/usr/bin/curl', ['--fail', '--location', '--proto', '=https', '--proto-redir', '=https', '--connect-timeout', '15', '--max-time', '120', '--output', dmg, `https://github.com/pulkitchandra1997/RepoDeck/releases/download/v0.1.1-preview.3/${path.basename(dmg)}`]);
    const { validateDmgDirectory } = require('./validate-dmg.cjs');
    await validateDmgDirectory({ bundleDirectory: downloads, expectedVersion: '0.1.1', expectedArch: target.arch, expectedSha256: target.sha256, signaturePolicy: 'ad-hoc', evidenceFile: path.join(evidenceDirectory, `packaging-${target.arch}.json`) });
    evidence.hashVerified = true;
    await fs.mkdir(mount);
    attachAttempted = true;
    run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmg], { input: 'Y\n' });
    const app = path.join(root, 'RepoDeck.app');
    run('/usr/bin/ditto', [path.join(mount, 'RepoDeck.app'), app]);
    run('/usr/bin/hdiutil', ['detach', mount]);
    detached = true;
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
    const settings = path.join(root, 'empty-settings');
    await fs.mkdir(settings, { mode: 0o700 });
    assert.deepEqual(await fs.readdir(settings), [], 'Settings must start empty');
    const executable = path.join(app, 'Contents', 'MacOS', 'repodeck-desktop');
    const stat = await fs.lstat(executable);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Copied executable must be regular');
    assert.equal(await fs.realpath(executable), executable, 'Executable must remain inside copied bundle');
    evidence.launch = await observeChild(spawn(executable, [], { cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: root, REPODECK_DATA_DIR: settings }, stdio: ['ignore', 'pipe', 'pipe'] }));
    assert.ok(evidence.launch.survived, 'Copied executable failed to survive 15 seconds; see launch evidence');
    assert.ok(evidence.launch.cleanupComplete, 'Owned process cleanup did not complete');
    assert.ok(!evidence.launch.processErrors?.length && !evidence.launch.cleanupErrors?.length, 'Owned process reported errors; see launch evidence');
    evidence.outcome = 'process-survived';
  } catch (error) {
    evidence.failure = error.message;
  } finally {
    if (attachAttempted && !detached) {
      try { run('/usr/bin/hdiutil', ['detach', mount]); detached = true; }
      catch (error) { evidence.detachFailure = error.message; evidence.outcome = 'failed'; }
    }
    // Never recursively remove a possibly mounted image or a live child's bundle.
    if ((!attachAttempted || detached) && (!evidence.launch || evidence.launch.cleanupComplete)) {
      try { await fs.rm(root, { recursive: true }); evidence.temporaryFilesRemoved = true; }
      catch (error) { evidence.cleanupFailure = error.message; evidence.outcome = 'failed'; }
    }
    evidence.finishedAt = new Date().toISOString();
    await fs.writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
  }
  console.log(`Hosted smoke outcome: ${evidence.outcome}; evidence: ${evidenceFile}`);
  if (evidence.outcome !== 'process-survived') process.exitCode = 1;
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { guardHost, observeChild };
