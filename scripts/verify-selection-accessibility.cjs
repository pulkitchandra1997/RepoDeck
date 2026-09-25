const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let server;
  try {
    const { preview } = await import('vite');
    server = await preview({ preview: { host: '127.0.0.1', port: 0, strictPort: false } });
    await fs.mkdir('.tools/screenshots', { recursive: true });
    const results = [];
    for (const width of [1280, 600]) {
      const page = await browser.newPage({ viewport: { width, height: 820 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        const settings = { schemaVersion: 1, onboardingCompleted: true, autoRefresh: false,
          workspaces: [{ id: 'one', name: 'First', rootPath: '/first' }, { id: 'two', name: 'Second', rootPath: '/second' }],
          theme: 'light', maxDepth: 12, maxEntries: 50000, excluded: ['.git'], showHidden: false, editor: 'code' };
        const snapshot = { entries: [], warnings: [], repositories: ['api', 'web'].map(relativePath => ({
          relativePath, error: null, status: { path: `/project/${relativePath}`, branch: 'main', detached: false,
            upstream: null, ahead: 0, behind: 0, remotes: [], changes: [] },
        })) };
        let callback = 0;
        window.__TAURI_INTERNALS__ = { transformCallback: () => ++callback, unregisterCallback: () => {}, invoke: async command => {
          if (command === 'check_git') return { available: true, platform: 'windows', message: 'Fixture Git' };
          if (command === 'get_settings') return settings;
          if (command === 'scan_workspace') return snapshot;
          if (command === 'watch_workspace' || command === 'stop_watch') return null;
          throw Error(`Unexpected fixture command: ${command}`);
        } };
      });
      await page.goto(server.resolvedUrls.local[0]);
      const nav = page.getByRole('navigation', { name: 'Workspaces' });
      const list = page.getByRole('region', { name: 'Repositories', exact: true });
      const first = nav.getByRole('button', { name: 'First', exact: true });
      const second = nav.getByRole('button', { name: 'Second', exact: true });
      const api = list.getByRole('button', { name: /^api/ });
      const web = list.getByRole('button', { name: /^web/ });
      const assertCurrent = async (container, button) => {
        assert.equal(await container.locator('[aria-current="true"]').count(), button ? 1 : 0);
        if (button) assert.equal(await button.getAttribute('aria-current'), 'true');
        assert.equal(await container.locator('button[aria-selected], [role="option"], [role="listbox"]').count(), 0);
      };
      const assertFocus = async button => {
        assert.equal(await button.evaluate(el => el === document.activeElement && el.tagName === 'BUTTON' && el.tabIndex === 0), true);
        assert.equal(await button.evaluate(el => el.matches(':focus-visible') && getComputedStyle(el).outlineStyle !== 'none' && parseFloat(getComputedStyle(el).outlineWidth) >= 2), true);
      };
      await api.waitFor();
      await assertCurrent(nav, first);
      await assertCurrent(list, null);
      await first.focus();
      await page.keyboard.press('Tab');
      assert.equal(await nav.getByRole('button', { name: 'Remove First from list' }).evaluate(el => el === document.activeElement), true);
      await page.keyboard.press('Tab');
      await assertFocus(second);
      await page.keyboard.press('Enter');
      await page.getByRole('heading', { name: 'Second', exact: true }).waitFor();
      await assertCurrent(nav, second);
      await assertFocus(second);
      await api.waitFor();
      await api.focus();
      await page.keyboard.press('Enter');
      await assertCurrent(list, api);
      await assertFocus(api);
      await page.keyboard.press('Tab');
      await assertFocus(web);
      await page.keyboard.press('Space');
      await assertCurrent(list, web);
      await assertFocus(web);
      assert.match(await list.ariaSnapshot(), /button "web/);
      assert.match(await nav.ariaSnapshot(), /button "Second/);
      await page.screenshot({ path: `.tools/screenshots/selection-accessibility-${width}.png`, fullPage: true });
      const filter = page.getByRole('textbox', { name: 'Filter workspace' });
      await filter.fill('api');
      await assertCurrent(list, null);
      await filter.fill('');
      await assertCurrent(list, web);
      const search = page.getByRole('textbox', { name: 'Search workspaces' });
      await search.fill('First');
      await assertCurrent(nav, null);
      await search.fill('');
      await assertCurrent(nav, second);
      await first.focus();
      await page.keyboard.press('Space');
      await page.getByRole('heading', { name: 'First', exact: true }).waitFor();
      await api.waitFor();
      await assertCurrent(nav, first);
      await assertCurrent(list, null);
      await assertFocus(first);
      assert.deepEqual(errors, []);
      results.push({ width, currentState: 'passed', nativeButtonKeyboardAndFocus: 'passed', browserRoles: 'passed', pageErrors: errors });
      await page.close();
    }
    await fs.writeFile('.tools/selection-accessibility.json', JSON.stringify({
      scope: 'Edge browser with fixture IPC; native screen readers not tested', results,
    }, null, 2));
    console.log('Selection accessibility passed at 1280/600px: unique current items, keyboard/focus, filtering, workspace reset and button roles. Native screen readers not tested.');
  } finally {
    await browser.close();
    if (server) await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
