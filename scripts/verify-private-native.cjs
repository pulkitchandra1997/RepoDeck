const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { chromium } = require('playwright');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  for (const key of ['REPODECK_TEST_EXE', 'REPODECK_PRIVATE_CHECKOUT', 'REPODECK_PRIVATE_REMOTE']) {
    assert.ok(process.env[key], `Missing ${key}; run through verify-private-git.cjs`);
  }
  const root = path.resolve(process.env.REPODECK_PRIVATE_CHECKOUT);
  const toolsRoot = path.resolve('.tools');
  await fs.mkdir(toolsRoot, { recursive: true });
  const profile = await fs.mkdtemp(path.join(toolsRoot, 'private-native-'));
  const settingsPath = path.join(profile, 'settings.json');
  const indexBefore = await fs.readFile(path.join(root, '.git', 'index'));
  const configBefore = await fs.readFile(path.join(root, '.git', 'config'));
  let child, browser, exited;
  try {
    await fs.writeFile(settingsPath, JSON.stringify({
      schemaVersion: 1, onboardingCompleted: true, workspaces: [{ id: randomUUID(), name: 'Private checkout', rootPath: root }],
      theme: 'light', maxDepth: 12, maxEntries: 50000, excluded: ['.git', 'node_modules'],
      showHidden: false, editor: 'code', autoRefresh: false,
    }));
    const settingsBefore = await fs.readFile(settingsPath);
    let failure, stderr = '';
    child = spawn(path.resolve(process.env.REPODECK_TEST_EXE), [], { windowsHide: true, stdio: 'pipe',
      env: { ...process.env, REPODECK_DATA_DIR: profile,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9228' } });
    child.on('error', error => { failure = error; });
    child.stderr.on('data', bytes => { stderr += bytes; });
    child.stdout.resume();
    exited = new Promise(resolve => child.once('close', resolve));
    for (let attempt = 0; attempt < 40; attempt++) {
      if (failure) throw failure;
      if (child.exitCode !== null) throw new Error(`Desktop exited: ${stderr}`);
      try { browser = await chromium.connectOverCDP('http://127.0.0.1:9228'); break; }
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
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('heading', { name: 'Private checkout', exact: true }).waitFor();
    assert.equal(new URL(page.url()).origin, 'http://tauri.localhost');
    await page.getByRole('button', { name: /Private checkout.*main.*2 changes/ }).click();
    await page.getByText(process.env.REPODECK_PRIVATE_REMOTE, { exact: true }).waitFor();
    await page.locator('.change-row').getByRole('button', { name: /README.md/ }).click();
    await page.locator('pre').filter({ hasText: '+Local change' }).waitFor();
    await page.locator('.change-row').getByRole('button', { name: /notes.txt/ }).click();
    await page.locator('pre').filter({ hasText: 'Untracked private note' }).waitFor();
    await page.setViewportSize({ width: 800, height: 600 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await fs.mkdir(path.join(toolsRoot, 'screenshots'), { recursive: true });
    await page.screenshot({ path: path.join(toolsRoot, 'screenshots', 'native-private-checkout.png') });
    await page.getByRole('tab', { name: 'Files', exact: true }).click();
    await page.getByRole('textbox', { name: 'Filter workspace' }).fill('README.md');
    await page.getByRole('button', { name: /^README.md,/ }).click();
    await page.locator('pre').filter({ hasText: 'Private fixture' }).waitFor();
    assert.deepEqual(await fs.readFile(path.join(root, '.git', 'index')), indexBefore);
    assert.deepEqual(await fs.readFile(path.join(root, '.git', 'config')), configBefore);
    assert.deepEqual(await fs.readFile(settingsPath), settingsBefore);
    assert.deepEqual(errors, []);
    console.log('PASS: installed private checkout status, remote display, diff, untracked preview and file tree; Git index/config and settings unchanged.');
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (child && child.exitCode === null) child.kill();
    if (exited) await exited;
    assert.equal(path.dirname(profile), toolsRoot);
    assert.ok(path.basename(profile).startsWith('private-native-'));
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
