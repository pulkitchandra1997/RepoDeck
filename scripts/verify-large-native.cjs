const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { chromium } = require('playwright');
const run = promisify(execFile);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  assert.ok(process.env.REPODECK_TEST_EXE, 'Set REPODECK_TEST_EXE to the installed Windows executable');
  const toolsRoot = path.resolve('.tools');
  await fs.mkdir(toolsRoot, { recursive: true });
  const profile = await fs.mkdtemp(path.join(toolsRoot, 'large-native-'));
  const root = path.join(profile, 'workspace');
  let child, browser, exited;
  try {
    await fs.mkdir(root);
    for (let repo = 0; repo < 20; repo++) {
      const directory = path.join(root, `service-${String(repo).padStart(2, '0')}`);
      await fs.mkdir(path.join(directory, 'src'), { recursive: true });
      const git = args => run('git', ['-c', 'core.hooksPath=', '-c', 'commit.gpgSign=false',
        '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-C', directory, ...args],
      { windowsHide: true, timeout: 30000 });
      await git(['init', '--initial-branch=main']);
      await fs.writeFile(path.join(directory, 'README.md'), 'Tracked fixture\n');
      await git(['add', 'README.md']);
      await git(['commit', '-m', 'Fixture']);
      for (let file = 0; file < 1000; file++) {
        await fs.writeFile(path.join(directory, 'src', `file-${String(file).padStart(4, '0')}.txt`), 'Large workspace preview\n');
      }
    }
    await fs.mkdir(path.join(root, 'notes'));
    await fs.writeFile(path.join(root, 'notes', 'design.md'), 'Non-Git notes\n');
    await fs.mkdir(path.join(root, '.claude'));
    await fs.writeFile(path.join(root, '.claude', 'settings.json'), '{}\n');
    await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({
      schemaVersion: 1, onboardingCompleted: true, workspaces: [{ id: randomUUID(), name: 'Large workspace', rootPath: root }],
      theme: 'light', maxDepth: 12, maxEntries: 50000, excluded: ['.git', 'node_modules'],
      showHidden: false, editor: 'code', autoRefresh: false,
    }));
    console.log('Fixture ready: 20 repositories, 20,000 source files, notes and agent settings.');
    let launchError, stderr = '';
    child = spawn(path.resolve(process.env.REPODECK_TEST_EXE), [], { windowsHide: true, stdio: 'pipe',
      env: { ...process.env, REPODECK_DATA_DIR: profile,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9227' } });
    child.on('error', error => { launchError = error; });
    child.stderr.on('data', bytes => { stderr += bytes; });
    child.stdout.resume();
    exited = new Promise(resolve => child.once('close', resolve));
    for (let attempt = 0; attempt < 40; attempt++) {
      if (launchError) throw launchError;
      if (child.exitCode !== null) throw new Error(`Desktop exited: ${stderr}`);
      try { browser = await chromium.connectOverCDP('http://127.0.0.1:9227'); break; }
      catch { await pause(500); }
    }
    assert.ok(browser, 'Desktop debugging endpoint unavailable');
    let page;
    for (let attempt = 0; attempt < 40; attempt++) {
      page = browser.contexts().flatMap(context => context.pages())[0];
      if (page) break;
      await pause(250);
    }
    assert.ok(page, 'Desktop webview unavailable');
    page.setDefaultTimeout(60000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('heading', { name: 'Large workspace', exact: true }).waitFor();
    assert.equal(new URL(page.url()).origin, 'http://tauri.localhost');
    const refresh = page.getByRole('button', { name: 'Refresh workspace', exact: true });
    await page.waitForFunction(() => !document.querySelector('[aria-label="Refresh workspace"]').disabled, undefined, { timeout: 60000 });
    assert.equal(await page.locator('.repo-row').count(), 20);
    assert.match(await page.getByRole('region', { name: 'Workspace summary' }).innerText(), /20\s+with changes/);
    await page.evaluate(() => {
      const gaps = [];
      let previous = performance.now();
      window.__largeProbe = { gaps, timer: setInterval(() => {
        const now = performance.now(); gaps.push(now - previous); previous = now;
      }, 50) };
    });
    const started = Date.now();
    await refresh.click();
    await page.getByRole('button', { name: 'Stop scan', exact: true }).waitFor();
    await page.getByRole('tab', { name: 'Files', exact: true }).click();
    const filter = page.getByRole('textbox', { name: 'Filter workspace' });
    await filter.fill('service-19/src/file-0999.txt');
    await page.getByRole('button', { name: /^service-19\/src\/file-0999.txt,/ }).click();
    await page.locator('pre').filter({ hasText: 'Large workspace preview' }).waitFor();
    await page.waitForFunction(() => !document.querySelector('[aria-label="Refresh workspace"]').disabled, undefined, { timeout: 60000 });
    const scanAndPreviewMs = Date.now() - started;
    await filter.fill('');
    await page.getByRole('button', { name: /^service-00, / }).click();
    await page.getByRole('button', { name: /^service-00\/src, / }).click();
    assert.ok(await page.locator('.file-row').count() <= 200, 'Initial tree must retain pagination');
    await filter.fill('notes/design.md');
    await page.getByRole('button', { name: /^notes\/design.md,/ }).click();
    await page.locator('pre').filter({ hasText: 'Non-Git notes' }).waitFor();
    await page.getByRole('tab', { name: 'Repositories', exact: true }).click();
    await refresh.click();
    await page.getByRole('button', { name: 'Stop scan', exact: true }).click();
    await page.getByText('Scan cancelled', { exact: true }).waitFor();
    assert.equal(await page.locator('.repo-row').count(), 20, 'Cancelled scan must retain completed snapshot');
    await page.getByRole('button', { name: /service-19.*main.*1000 changes/ }).click();
    assert.equal(await page.locator('.change-row').count(), 1000);
    await page.locator('.change-row').getByRole('button', { name: /src\/file-0999.txt/ }).click();
    await page.locator('pre').filter({ hasText: 'Large workspace preview' }).waitFor();
    const gaps = await page.evaluate(() => {
      clearInterval(window.__largeProbe.timer); return window.__largeProbe.gaps;
    });
    gaps.sort((a, b) => a - b);
    assert.ok(gaps.length > 20, 'Responsiveness sampler must run throughout the workflow');
    const maximumGap = gaps.at(-1);
    assert.ok(maximumGap < 2000, `UI event loop stalled for ${maximumGap.toFixed(0)}ms`);
    for (const width of [1280, 800]) {
      await page.setViewportSize({ width, height: 820 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await fs.mkdir(path.join(toolsRoot, 'screenshots'), { recursive: true });
      await page.screenshot({ path: path.join(toolsRoot, 'screenshots', `large-native-${width}.png`) });
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ scanAndPreviewMs, heartbeatSamples: gaps.length,
      p95HeartbeatGapMs: gaps[Math.floor(gaps.length * 0.95)], maximumHeartbeatGapMs: maximumGap }));
    console.log('PASS: installed large-workspace scan, filtering, previews, pagination, 1,000-file change list and cancellation.');
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (child && child.exitCode === null) child.kill();
    if (exited) await exited;
    assert.equal(path.dirname(profile), toolsRoot);
    assert.ok(path.basename(profile).startsWith('large-native-'));
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
