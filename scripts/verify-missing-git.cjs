const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

(async () => {
  const profile = await fs.mkdtemp(path.resolve('.tools/missing-git-profile-'));
  const settingsPath = path.join(profile, 'settings.json');
  const root = path.resolve('.tools/fixtures/express');
  const originalIndex = await fs.readFile(path.join(root, '.git/index'));
  await fs.writeFile(settingsPath, JSON.stringify({
    schemaVersion: 1, onboardingCompleted: true, workspaces: [{ id: randomUUID(), name: 'Express', rootPath: root }],
    theme: 'light', maxDepth: 12, maxEntries: 50000, excluded: ['.git', 'node_modules'],
    showHidden: false, editor: 'code', autoRefresh: false,
  }));
  const originalSettings = await fs.readFile(settingsPath);
  const executable = path.resolve(process.env.REPODECK_TEST_EXE || 'target/debug/repodeck-desktop.exe');
  for (const missing of [true, false]) {
    const env = { ...process.env, REPODECK_DATA_DIR: profile,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9226' };
    if (missing) {
      for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
      env.PATH = profile;
      // Isolate standard-location discovery as well as PATH, only in this child.
      for (const key of Object.keys(env)) if (['programw6432', 'programfiles', 'programfiles(x86)', 'localappdata'].includes(key.toLowerCase())) delete env[key];
      env.ProgramW6432 = profile;
      env.ProgramFiles = profile;
      env['ProgramFiles(x86)'] = profile;
      env.LOCALAPPDATA = profile;
    }
    const child = spawn(executable, [], { cwd: profile, windowsHide: true, env, stdio: 'pipe' });
    let failure;
    let stderr = '';
    child.on('error', error => { failure = error; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const exited = new Promise(resolve => child.once('close', resolve));
    let browser;
    try {
      for (let attempt = 0; attempt < 40; attempt++) {
        if (failure) throw failure;
        if (child.exitCode !== null) throw new Error(`Desktop exited: ${stderr}`);
        try { browser = await chromium.connectOverCDP('http://127.0.0.1:9226'); break; }
        catch { await new Promise(resolve => setTimeout(resolve, 500)); }
      }
      assert.ok(browser, 'Desktop debugging endpoint unavailable');
      let page;
      for (let attempt = 0; attempt < 40; attempt++) {
        page = browser.contexts().flatMap(context => context.pages())[0];
        if (page) break;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      assert.ok(page, 'Desktop webview unavailable');
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      if (missing) await page.getByRole('button', { name: 'Continue with files' }).click();
      await page.getByRole('heading', { name: 'Express', exact: true }).waitFor();
      if (process.env.REPODECK_TEST_EXE) assert.ok(!page.url().includes(':1420'), 'Installed app uses dev server');
      await page.getByRole('button', { name: missing ? /Express.*Unavailable.*Error/ : /Express.*(?:master|main).*Clean/ }).click();
      if (missing) {
        await page.getByRole('region', { name: 'Workspace summary' }).getByText('1 unavailable').waitFor();
        await page.getByText('Git could not start. Install Git and restart RepoDeck.', { exact: true }).waitFor();
        const inspector = page.getByRole('region', { name: 'Inspector' });
        assert.doesNotMatch(await inspector.innerText(), /Detached HEAD|ahead|behind/);
        assert.equal(await inspector.getByRole('button', { name: 'Hooks and LFS' }).count(), 0);
        await page.setViewportSize({ width: 800, height: 600 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Missing-Git layout overflows');
        await fs.mkdir('.tools/screenshots', { recursive: true });
        await page.screenshot({ path: '.tools/screenshots/native-missing-git.png' });
      } else {
        assert.equal(await page.getByRole('region', { name: 'Workspace summary' }).getByText('1 unavailable').count(), 0);
        assert.equal(await page.getByText('Git could not start. Install Git and restart RepoDeck.', { exact: true }).count(), 0);
      }
      await page.getByRole('tab', { name: 'Files', exact: true }).click();
      await page.getByRole('textbox', { name: 'Filter workspace' }).fill('package.json');
      await page.getByRole('button', { name: /^package.json,/ }).click();
      await page.locator('pre').filter({ hasText: '"name": "express"' }).waitFor();
      assert.deepEqual(await fs.readFile(settingsPath), originalSettings);
      assert.deepEqual(await fs.readFile(path.join(root, '.git/index')), originalIndex);
      assert.deepEqual(errors, []);
      console.log(`${missing ? 'Missing Git' : 'Git restored'} passed (${page.url()}): repository status, file preview, settings/index preservation.`);
    } finally {
      if (browser) await browser.close().catch(() => {});
      if (child.exitCode === null) child.kill();
      await exited;
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
