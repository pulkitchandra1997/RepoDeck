const { chromium } = require('playwright');
const fs = require('node:fs/promises');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 660 }, deviceScaleFactor: 1 });
    await page.addInitScript(() => {
      const settings = { schemaVersion: 1, onboardingCompleted: true, workspaces: [{ id: 'sample', name: 'Commerce', rootPath: '/Projects/commerce' }], theme: 'light', editor: 'code', maxDepth: 12, maxEntries: 50000, excluded: ['.git'], showHidden: false, autoRefresh: false };
      const status = (relativePath, changes) => ({ relativePath, error: null, status: { path: `/Projects/commerce/${relativePath}`, branch: 'feature/checkout', detached: false, upstream: null, ahead: 0, behind: 0, changes, remotes: [] } });
      const snapshot = { warnings: [], repositories: [status('apps/storefront', [{ path: 'src/checkout.ts', originalPath: null, index: ' ', worktree: 'M' }]), status('services/payments', [])], entries: [
        { path: 'AGENTS.md', directory: false, repository: false, agentConfig: true, size: 104, modifiedMs: 0 },
        { path: 'notes', directory: true, repository: false, agentConfig: false, size: 0, modifiedMs: 0 },
        { path: 'notes/design.md', directory: false, repository: false, agentConfig: false, size: 70, modifiedMs: 0 },
      ] };
      window.__TAURI_INTERNALS__ = { transformCallback: () => 1, unregisterCallback: () => {}, invoke: async command => {
        if (command === 'check_git') return { available: true, platform: 'windows', message: 'Git available' };
        if (command === 'get_settings') return settings;
        if (command === 'scan_workspace') return snapshot;
        if (command === 'file_diff') return '@@ -1,2 +1,2 @@\n-const timeout = 1000;\n+const timeout = 3000;';
        if (command === 'preview_file') return { kind: 'text', content: '# Project instructions\n\nRun tests before changing shared interfaces.\nKeep credentials out of source control.' };
        throw new Error(`Unexpected image fixture command: ${command}`);
      } };
    });
    await page.goto('http://127.0.0.1:1420');
    await page.getByRole('heading', { name: 'Commerce', exact: true }).waitFor();
    const directory = 'apps/desktop/src/assets/onboarding';
    await fs.mkdir(directory, { recursive: true });
    await page.getByRole('button', { name: 'Add workspace', exact: true }).evaluate(el => el.style.outline = '3px solid #18725b');
    await page.screenshot({ path: `${directory}/add-workspace.png` });
    await page.getByRole('button', { name: 'Add workspace', exact: true }).evaluate(el => el.style.outline = '');
    await page.getByRole('button', { name: /apps\/storefront.*1 change/ }).click();
    await page.getByRole('button', { name: /src\/checkout.ts/ }).click();
    await page.locator('pre').filter({ hasText: '+const timeout' }).waitFor();
    await page.screenshot({ path: `${directory}/review-changes.png` });
    await page.getByRole('tab', { name: 'Agents', exact: true }).click();
    await page.getByRole('button', { name: /^AGENTS.md,/ }).click();
    await page.locator('pre').filter({ hasText: 'Project instructions' }).waitFor();
    await page.screenshot({ path: `${directory}/agent-files.png` });
    console.log('Created three actual RepoDeck UI screenshots using inert sample data.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
