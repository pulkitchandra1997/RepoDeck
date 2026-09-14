const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let server;
  try {
    const { preview } = await import('vite');
    server = await preview({ preview: { host: '127.0.0.1', port: 0, strictPort: false } });
    const url = server.resolvedUrls.local[0];
    await fs.mkdir('.tools/screenshots', { recursive: true });
    for (const width of [1280, 800, 600]) {
      const page = await browser.newPage({ viewport: { width, height: 820 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        let settings = JSON.parse(localStorage.getItem('metadata-test') || 'null') || { schemaVersion: 1, onboardingCompleted: true, workspaces: [{ id: 'fixture', name: 'Commerce', rootPath: 'C:/Projects/commerce' }], theme: 'light', maxDepth: 12, maxEntries: 50000, excluded: ['.git'], showHidden: false, editor: 'code' };
        const entry = (path, directory = false, repository = false) => ({ path, directory, repository, agentConfig: false, size: 20, modifiedMs: 0 });
        const changes = [{ path: 'Main.java', index: ' ', worktree: 'M', originalPath: null }, { path: 'new.java', index: '?', worktree: '?', originalPath: null }, { path: 'conflict.java', index: 'U', worktree: 'U', originalPath: null }];
        const repo = (relativePath, changes) => ({ relativePath, error: null, status: { path: `C:/Projects/commerce/${relativePath}`, originUrl: `https://example.org/team/${relativePath === 'services/api' ? 'payments-api' : 'worker'}.git`, branch: 'main', detached: false, upstream: null, ahead: 0, behind: 0, remotes: [], changes } });
        const snapshot = { entries: [entry('services', true), entry('services/api', true, true), entry('services/api/pom.xml'), ...changes.map(c => entry(`services/api/${c.path}`)), entry('worker', true, true), entry('worker/pyproject.toml')], repositories: [repo('services/api', changes), repo('worker', [])], warnings: [] };
        snapshot.entries.push(...['constructor', '__proto__', 'toString', 'main.constructor', 'csproj', 'go'].map(name => entry(`worker/${name}`)));
        let callback = 0;
        window.__TAURI_INTERNALS__ = { transformCallback: () => ++callback, unregisterCallback: () => {}, invoke: async (command, args) => {
          if (command === 'check_git') return { available: true, platform: 'windows', message: 'Fixture Git' };
          if (command === 'get_settings') return settings;
          if (command === 'save_settings') {
            if (window.holdMetadataSave) await new Promise(resolve => { window.releaseMetadataSave = resolve; });
            settings = args.settings; localStorage.setItem('metadata-test', JSON.stringify(settings)); return settings;
          }
          if (command === 'scan_workspace') return snapshot;
          if (command === 'watch_workspace' || command === 'stop_watch') return null;
          if (command === 'file_diff') return '@@ -1,2 +1,2 @@\n-old\n+new\n---old value\n+++new value';
          if (command === 'preview_file') return { kind: 'text', content: '<<<<<<< HEAD\nlocal\n=======\nremote\n>>>>>>> other' };
          throw Error(`Unexpected command ${command}`);
        } };
      });
      await page.goto(url);
      await page.getByRole('button', { name: /^payments-api/ }).click();
      assert.equal(await page.locator('.listing .list-search').count(), 1);
      assert.equal(await page.getByRole('textbox', { name: 'Search workspaces' }).count(), 1);
      await page.getByRole('textbox', { name: 'Search workspaces' }).fill('no-such-workspace');
      await page.getByText('No workspaces match.', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Clear workspace search' }).click();
      assert.equal(await page.getByRole('textbox', { name: 'Search workspaces' }).evaluate(el => el === document.activeElement), true);
      assert.equal(await page.locator('.repo-row').first().evaluate(row => {
        const name = row.querySelector('.repo-name').getBoundingClientRect();
        const badges = row.querySelector('.project-types').getBoundingClientRect();
        return badges.left >= name.right && badges.right <= row.getBoundingClientRect().right;
      }), true);
      assert.equal(await page.locator('.project-types').filter({ hasText: 'Java' }).count(), 1);
      assert.equal(await page.locator('.project-types').filter({ hasText: 'Python' }).count(), 1);
      assert.equal(await page.locator('.repo-row').filter({ hasText: 'worker' }).locator('.project-types').innerText(), 'Python');
      await page.getByRole('button', { name: 'Edit custom name' }).click();
      await page.getByLabel('Custom name', { exact: true }).fill('Checkout service');
      await page.evaluate(() => { window.holdMetadataSave = true; });
      await page.getByRole('button', { name: 'Save custom name' }).click();
      await page.waitForFunction(() => typeof window.releaseMetadataSave === 'function');
      assert.equal(await page.getByRole('button', { name: 'Settings', exact: true }).isDisabled(), true);
      assert.equal(await page.getByRole('button', { name: 'Pause automatic refresh' }).isDisabled(), true);
      await page.evaluate(() => { window.holdMetadataSave = false; window.releaseMetadataSave(); });
      await page.getByRole('button', { name: /^Checkout service/ }).waitFor();
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Edit custom name');
      await page.getByRole('button', { name: 'Edit custom name' }).click();
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Edit custom name');
      await page.getByRole('button', { name: 'Edit custom name' }).click();
      await page.getByLabel('Custom name', { exact: true }).fill('Unsubmitted draft');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Discard changes' }).click();
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Edit custom name');
      await page.reload();
      await page.getByRole('textbox', { name: 'Filter workspace' }).fill('Checkout');
      await page.getByRole('button', { name: /^Checkout service/ }).click();
      await page.getByRole('button', { name: /Main.java/ }).click();
      await page.locator('pre .green').filter({ hasText: /^\+new\s*$/ }).waitFor();
      assert.equal(await page.locator('pre .danger').filter({ hasText: /^-old\s*$/ }).count(), 1);
      assert.equal(await page.locator('pre .danger').filter({ hasText: '---old value' }).count(), 1);
      assert.equal(await page.locator('pre .green').filter({ hasText: '+++new value' }).count(), 1);
      assert.deepEqual(await page.locator('pre .source-line').evaluateAll(rows => rows.map(row => [...row.querySelectorAll('.line-number')].map(gutter => gutter.dataset.line))), [['', ''], ['1', ''], ['', '1'], ['2', ''], ['', '2']]);
      await page.locator('pre').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `.tools/screenshots/repository-metadata-${width}.png` });
      await page.getByRole('button', { name: 'Clear list search' }).click();
      assert.equal(await page.getByRole('textbox', { name: 'Filter workspace' }).evaluate(el => el === document.activeElement), true);
      await page.getByRole('tab', { name: 'Files', exact: true }).click();
      await page.getByRole('button', { name: /^services,/ }).click();
      await page.getByRole('button', { name: /^services\/api,/ }).click();
      assert.equal(await page.locator('.file-row.green').count(), 1);
      assert.equal(await page.locator('.file-row.amber').filter({ hasText: 'Main.java' }).count(), 1);
      const conflict = page.getByRole('button', { name: /services\/api\/conflict.java.*Conflict/ });
      await conflict.click();
      await page.locator('pre .conflict-line').first().waitFor();
      assert.equal(await page.locator('pre .line-number').count(), 5);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: `.tools/screenshots/file-status-${width}.png` });
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByLabel('Appearance').selectOption('dark');
      await page.getByRole('button', { name: 'Save settings' }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.screenshot({ path: `.tools/screenshots/numbered-dark-${width}.png` });
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('Repository metadata UI passed at 1280/800/600: language badges, alias persistence/search, file colors, diff colors and conflicts. Fixture IPC only.');
  } finally { await browser.close(); if (server) await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve())); }
})().catch(error => { console.error(error); process.exitCode = 1; });
