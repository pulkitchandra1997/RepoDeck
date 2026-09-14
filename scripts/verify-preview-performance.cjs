const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let server;
  try {
    const { preview } = await import('vite');
    server = await preview({ preview: { host: '127.0.0.1', port: 0, strictPort: false } });
    const results = [];
    for (const [lineCount, width] of [[1000, 1280], [50000, 1280], [250000, 1280], [250000, 600]]) {
      const page = await browser.newPage({ viewport: { width, height: 820 } });
      page.setDefaultTimeout(60000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(lineCount => {
        const settings = { schemaVersion: 1, onboardingCompleted: true, workspaces: [{ id: 'fixture', name: 'Preview benchmark', rootPath: 'C:/Projects/benchmark' }], theme: 'light', maxDepth: 12, maxEntries: 50000, excluded: ['.git'], showHidden: false, editor: 'code' };
        const content = lineCount > 50000 ? 'x\n'.repeat(lineCount) : Array.from({ length: lineCount }, (_, i) => `line ${i + 1}`).join('\n');
        let callback = 0;
        window.__TAURI_INTERNALS__ = { transformCallback: () => ++callback, unregisterCallback: () => {}, invoke: async command => {
          if (command === 'check_git') return { available: true, platform: 'windows', message: 'Fixture Git' };
          if (command === 'get_settings') return settings;
          if (command === 'scan_workspace') return { repositories: [], warnings: [], entries: [{ path: 'large.txt', directory: false, repository: false, agentConfig: false, size: content.length, modifiedMs: 0 }] };
          if (command === 'watch_workspace' || command === 'stop_watch') return null;
          if (command === 'preview_file') { window.previewStart = performance.now(); return { kind: 'text', content }; }
          throw Error(`Unexpected command ${command}`);
        } };
      }, lineCount);
      await page.goto(server.resolvedUrls.local[0]);
      await page.getByRole('tab', { name: 'Files', exact: true }).click();
      await page.getByRole('button', { name: /^large.txt,/ }).click();
      await page.locator('pre .source-line').first().waitFor();
      const result = await page.evaluate(() => ({ elapsedMs: performance.now() - window.previewStart, renderedRows: document.querySelectorAll('pre .source-line').length, totalElements: document.querySelectorAll('*').length, overflow: document.documentElement.scrollWidth > innerWidth }));
      assert.equal(result.renderedRows, Math.min(1000, lineCount));
      assert.equal(await page.locator('pre .line-number').last().getAttribute('data-line'), String(Math.min(1000, lineCount)));
      if (lineCount > 1000) {
        await page.getByRole('button', { name: 'Last lines' }).click();
        assert.equal(await page.locator('pre .line-number').last().getAttribute('data-line'), String(lineCount));
      }
      assert.equal(await page.locator('pre .line-number').first().evaluate(el => el.scrollWidth <= el.clientWidth), true);
      assert.equal(await page.locator('pre .source-line').first().evaluate(el => el.getBoundingClientRect().height <= Math.ceil(parseFloat(getComputedStyle(el).lineHeight)) + 1), true);
      assert.equal(result.overflow, false);
      assert.deepEqual(errors, []);
      results.push({ lineCount, width, ...result });
      await fs.mkdir('.tools/screenshots', { recursive: true });
      await page.screenshot({ path: `.tools/screenshots/preview-${lineCount}-${width}.png` });
      await page.close();
    }
    await fs.writeFile('.tools/preview-performance.json', JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await browser.close();
    if (server) await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
