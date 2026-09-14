// Loopback-only authenticated Git fixture. Never uses account credentials.
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');

function run(program, args, env, cwd, input = null) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { env, cwd, windowsHide: true, stdio: 'pipe' });
    const stdout = [], stderr = [];
    const timeout = setTimeout(() => child.kill(), 120000);
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timeout);
      resolve({ code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString() });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

async function main() {
  const tls = process.env.REPODECK_TEST_TLS === '1';
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repodeck-private-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  Object.assign(env, {
    RUSTUP_HOME: process.env.RUSTUP_HOME || path.join(os.homedir(), '.rustup'),
    CARGO_HOME: process.env.CARGO_HOME || path.join(os.homedir(), '.cargo'),
    HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: root,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(root, 'empty-config'),
    GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never',
    GIT_AUTHOR_NAME: 'RepoDeck Test', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'RepoDeck Test', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
  });
  await fs.writeFile(env.GIT_CONFIG_GLOBAL, '');
  const git = async (args, extra = {}) => run('git', ['-c', 'credential.helper=', '-c', 'core.hooksPath=',
    ...(tls ? ['-c', 'http.sslBackend=openssl', '-c', 'http.sslVerify=true'] : []), ...args], { ...env, ...extra }, root);
  const checked = async (args, extra) => {
    const result = await git(args, extra);
    assert.equal(result.code, 0, result.stderr);
    return result;
  };
  const seed = path.join(root, 'seed');
  const checkout = path.join(root, 'checkout');
  const user = 'fixture';
  const password = randomBytes(24).toString('hex');
  const authorization = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
  let denied = 0, accepted = 0, server;
  try {
    await checked(['init', '--initial-branch=main', seed]);
    await fs.writeFile(path.join(seed, 'README.md'), 'Private fixture\n');
    await checked(['-C', seed, 'add', 'README.md']);
    await checked(['-C', seed, 'commit', '-m', 'Fixture']);
    await checked(['clone', '--bare', seed, path.join(root, 'private.git')]);
    await checked(['--git-dir', path.join(root, 'private.git'), 'update-server-info']);
    let tlsOptions;
    if (tls) {
      const result = await run('pwsh', ['-NoProfile', '-NonInteractive', '-File',
        path.resolve('scripts/fixtures/create-tls-fixture.ps1'), '-Directory', root], env, root);
      assert.equal(result.code, 0, result.stderr);
      tlsOptions = { key: await fs.readFile(path.join(root, 'server-key.pem')), cert: await fs.readFile(path.join(root, 'server.pem')) };
    }
    const handler = async (req, res) => {
      if (req.headers.authorization !== authorization) {
        denied++;
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="RepoDeck fixture"' });
        res.end('Authentication required');
        return;
      }
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method !== 'GET' || !/^\/private\.git\/(HEAD|info\/refs|objects\/info\/packs|objects\/[0-9a-f]{2}\/[0-9a-f]{38})$/.test(url.pathname)) {
        res.writeHead(404).end();
        return;
      }
      accepted++;
      try {
        const bytes = await fs.readFile(path.join(root, url.pathname.slice(1)));
        res.setHeader('Content-Type', 'application/octet-stream');
        res.end(bytes);
      } catch (error) {
        res.writeHead(500).end('Fixture backend failed');
        console.error(error.message);
      }
    };
    server = tls ? https.createServer(tlsOptions, handler) : http.createServer(handler);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `${tls ? 'https' : 'http'}://127.0.0.1:${server.address().port}/private.git`;
    if (tls) {
      const untrusted = await git(['ls-remote', url]);
      assert.notEqual(untrusted.code, 0, 'Untrusted certificate must fail');
      assert.match(untrusted.stderr, /SSL certificate.*(unable to get local issuer|self.signed)/i);
      assert.equal(accepted + denied, 0, 'TLS rejection must precede HTTP authentication');
      env.GIT_SSL_CAINFO = path.join(root, 'ca.pem');
      const wrongHost = await git(['ls-remote', url.replace('127.0.0.1', 'localhost')]);
      assert.notEqual(wrongHost.code, 0, 'Certificate hostname mismatch must fail');
      assert.match(wrongHost.stderr, /certificate.*(subject|host|name)/i);
      assert.equal(accepted + denied, 0, 'Hostname rejection must precede HTTP authentication');
    }
    assert.notEqual((await git(['ls-remote', url])).code, 0, 'Anonymous access must fail');
    assert.equal(accepted, 0);
    const helper = '!f() { if test "$1" = get; then printf "username=%s\\npassword=%s\\n" "$REPODECK_FIXTURE_USER" "$REPODECK_FIXTURE_PASSWORD"; fi; }; f';
    const credentials = { REPODECK_FIXTURE_USER: user, REPODECK_FIXTURE_PASSWORD: password };
    assert.notEqual((await git(['-c', `credential.helper=${helper}`, 'ls-remote', url], {
      ...credentials, REPODECK_FIXTURE_PASSWORD: 'incorrect',
    })).code, 0, 'Incorrect credentials must fail');
    assert.equal(accepted, 0);
    await checked(['-c', `credential.helper=${helper}`, 'clone', url, checkout], credentials);
    assert.ok(denied >= 2 && accepted >= 2, 'Must exercise authentication and static HTTP transfer');
    const config = await fs.readFile(path.join(checkout, '.git/config'), 'utf8');
    assert.ok(!config.includes(password), 'Password must not persist in repository configuration');
    const persistedOverrides = await git(['-C', checkout, 'config', '--local', '--get-regexp',
      '^(credential\\.helper|http\\..*(sslverify|sslcainfo))$']);
    assert.equal(persistedOverrides.code, 1, 'Credential/TLS overrides must not persist');
    await new Promise(resolve => server.close(resolve));
    server = null;
    await fs.appendFile(path.join(checkout, 'README.md'), 'Local change\n');
    await fs.writeFile(path.join(checkout, 'notes.txt'), 'Untracked private note\n');
    const result = await run(process.env.CARGO || 'cargo', [
      'test', '-p', 'repodeck-core', '--test', 'private_repository', '--', '--ignored', '--nocapture',
    ], { ...env, REPODECK_PRIVATE_CHECKOUT: checkout, REPODECK_PRIVATE_REMOTE: url }, process.cwd());
    assert.equal(result.code, 0, result.stderr + result.stdout);
    console.log(result.stdout.toString().trim());
    if (process.env.REPODECK_TEST_EXE) {
      const native = await run(process.execPath, ['scripts/verify-private-native.cjs'], {
        ...env, REPODECK_PRIVATE_CHECKOUT: checkout, REPODECK_PRIVATE_REMOTE: url,
      }, process.cwd());
      assert.equal(native.code, 0, native.stderr + native.stdout);
      console.log(native.stdout.toString().trim());
    }
    console.log('PASS: anonymous/wrong credentials rejected; authenticated clone; no stored credential; offline RepoDeck inspection.');
    if (tls) console.log('PASS: untrusted certificate and wrong hostname rejected; explicit temporary CA trust; TLS verification enabled.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    // Only the unique directory created by mkdtemp above is eligible for cleanup.
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('repodeck-private-'));
    await fs.rm(root, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
