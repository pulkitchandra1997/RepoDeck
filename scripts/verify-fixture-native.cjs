const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');

(async () => {
  assert.ok(process.env.REPODECK_TEST_EXE, 'Set REPODECK_TEST_EXE to the installed executable');
  assert.ok(process.env.REPODECK_FIXTURE_MANIFEST, 'Set REPODECK_FIXTURE_MANIFEST');
  const manifestPath = path.resolve(process.env.REPODECK_FIXTURE_MANIFEST);
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const profile = await fs.mkdtemp(path.join(path.dirname(manifestPath), 'desktop-test-'));
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ schemaVersion: 1, onboardingCompleted: true,
    workspaces: [{ id: randomUUID(), name: 'RepoDeck Test Workspace', rootPath: manifest.workspace }],
    theme: 'light', maxDepth: 12, maxEntries: 50000,
    excluded: ['.git', 'node_modules', 'target', 'dist', 'build', '.venv', 'venv'],
    showHidden: false, editor: 'code', autoRefresh: false,
  }));
  const child = spawn(path.resolve(process.env.REPODECK_TEST_EXE), [], { windowsHide: true,
    env: { ...process.env, REPODECK_DATA_DIR: profile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9229' }, stdio: 'ignore' });
  let startupError;
  child.on('error', error => { startupError = error; });
  const exited = new Promise(resolve => child.once('close', resolve));
  let browser;
  try {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (startupError) throw startupError;
      if (child.exitCode !== null) throw new Error('Desktop exited before connection');
      try { browser = await chromium.connectOverCDP('http://127.0.0.1:9229'); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 400)); }
    }
    assert.ok(browser, 'Desktop endpoint unavailable');
    let page;
    for (let attempt = 0; attempt < 50; attempt++) {
      page = browser.contexts().flatMap(context => context.pages())[0];
      if (page) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.ok(page, 'Desktop page unavailable');
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('region', { name: 'Workspace summary' }).getByText(`${manifest.repositoryCount} repositories`, { exact: false }).waitFor({ timeout: 60000 });
    assert.ok(!page.url().includes(':1420'), 'Installed executable uses the dev server');
    await page.getByRole('button', { name: /05-edge-cases\/merge-conflict.*1 conflict/ }).click();
    await page.getByRole('region', { name: 'Inspector' }).getByRole('button', { name: /README.md/ }).click();
    await page.locator('pre').filter({ hasText: 'Main branch content' }).waitFor();
    await page.getByRole('button', { name: /07-submodules\/application\/vendor\/library.*Detached HEAD.*1 change/ }).click();
    await page.getByRole('region', { name: 'Inspector' }).getByRole('button', { name: /README.md/ }).click();
    await page.locator('pre').filter({ hasText: 'Local submodule change' }).waitFor();
    await page.getByRole('tab', { name: 'Agents', exact: true }).click();
    await page.getByRole('textbox', { name: 'Filter workspace' }).fill('.claude/settings.json');
    assert.ok(await page.getByRole('button', { name: /\.claude\/settings.json/ }).count() >= 2);
    await page.getByRole('tab', { name: 'Files', exact: true }).click();
    await page.getByRole('textbox', { name: 'Filter workspace' }).fill('08-not-a-repository/design/brief.md');
    await page.getByRole('button', { name: /08-not-a-repository\/design\/brief.md/ }).click();
    await page.locator('pre').filter({ hasText: 'Ordinary project notes' }).waitFor();
    await page.getByRole('textbox', { name: 'Filter workspace' }).fill('');
    await page.getByRole('tab', { name: 'Repositories', exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 820 });
    await fs.mkdir('.tools/screenshots', { recursive: true });
    await page.screenshot({ path: '.tools/screenshots/manual-workspace.png' });
    assert.deepEqual(errors, []);
    console.log(`Installed fixture passed: ${manifest.repositoryCount} repositories, conflict diff, detached submodule diff, agent settings and non-Git preview.`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (child.exitCode === null) child.kill();
    await exited;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
