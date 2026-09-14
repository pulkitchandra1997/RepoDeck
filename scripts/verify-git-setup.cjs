const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const platform of ['windows', 'macos']) for (const width of [800, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 820 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(platform => {
        window.setupRequests = 0;
        window.gitReady = false;
        window.__TAURI_INTERNALS__ = { invoke: async command => {
          if (command === 'check_git') return { available: window.gitReady, platform, message: 'Git was not found. Install Git, then check again.' };
          if (command === 'install_git') { window.setupRequests++; return 'Finish the external installer, then check again.'; }
          if (command === 'get_settings') return { schemaVersion: 1, onboardingCompleted: true, workspaces: [], theme: 'light', maxDepth: 12, maxEntries: 50000, excluded: ['.git'], showHidden: false, editor: 'code' };
          throw new Error(`Unexpected command: ${command}`);
        } };
      }, platform);
      await page.goto('http://127.0.0.1:1420');
      await page.getByRole('heading', { name: 'Git setup', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.setupRequests), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.getByRole('button', { name: platform === 'macos' ? 'Install Command Line Tools' : 'Open Git download' }).click();
      assert.equal(await page.evaluate(() => window.setupRequests), 0);
      await page.screenshot({ path: `.tools/screenshots/git-confirm-${platform}-${width}.png` });
      await page.getByRole('button', { name: platform === 'macos' ? 'Request installation' : 'Open download page' }).click();
      await page.getByRole('status').filter({ hasText: 'Finish the external installer' }).waitFor();
      await page.getByRole('button', { name: 'Check again' }).click();
      await page.getByRole('button', { name: 'Check again' }).waitFor();
      assert.equal(await page.getByRole('heading', { name: 'Git setup' }).count(), 1);
      await fs.mkdir('.tools/screenshots', { recursive: true });
      await page.screenshot({ path: `.tools/screenshots/git-setup-${platform}-${width}.png` });
      await page.evaluate(() => { window.gitReady = true; });
      await page.getByRole('button', { name: 'Check again' }).click();
      await page.getByRole('button', { name: 'Settings', exact: true }).waitFor();
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('Git setup UI passed: Windows/macOS at 800/1280, explicit install action, recheck stays blocked until ready, no overflow or page errors. Mocked platform responses; no installers executed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
