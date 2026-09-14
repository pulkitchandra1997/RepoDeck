const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    await fs.mkdir('.tools/screenshots', { recursive: true });
    for (const [width, height] of [[1280, 820], [800, 600], [600, 800]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        let settings = JSON.parse(localStorage.getItem('tour-settings') || 'null') || { schemaVersion: 1, workspaces: [], theme: 'light', editor: 'code', maxDepth: 12, maxEntries: 50000, excluded: ['.git'], showHidden: false, onboardingCompleted: false };
        window.pickerCalls = 0;
        window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
          if (command === 'check_git') return { available: true, platform: 'windows', message: 'Git available' };
          if (command === 'get_settings') return settings;
          if (command === 'save_settings') { settings = args.settings; localStorage.setItem('tour-settings', JSON.stringify(settings)); return settings; }
          if (command === 'add_workspace') { window.pickerCalls++; return null; }
          throw new Error(`Unexpected command: ${command}`);
        } };
      });
      await page.goto('http://127.0.0.1:1420');
      for (let step = 1; step <= 3; step++) {
        await page.getByText(`${step} of 3`, { exact: true }).waitFor();
        await page.getByRole('img').evaluate(async image => { await image.decode(); });
        assert.ok(await page.getByRole('img').evaluate(image => image.naturalWidth > 0 && image.getBoundingClientRect().height > 100));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: `.tools/screenshots/onboarding-${width}-${step}.png`, fullPage: true });
        if (step < 3) await page.getByRole('button', { name: 'Next', exact: true }).click();
      }
      await page.getByRole('button', { name: 'Add a workspace' }).click();
      await page.getByRole('button', { name: 'Show tour' }).waitFor();
      assert.equal(await page.evaluate(() => window.pickerCalls), 1);
      await page.reload();
      await page.getByRole('button', { name: 'Show tour' }).waitFor();
      assert.equal(await page.getByRole('heading', { name: 'Choose a project folder' }).count(), 0);
      await page.getByRole('button', { name: 'Show tour' }).click();
      await page.getByRole('button', { name: 'Close tour' }).click();
      await page.getByRole('button', { name: 'Settings', exact: true }).waitFor();
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('Onboarding passed: all three images, navigation, one folder-picker request, persisted completion, replay and 1280/800/600px layouts.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
