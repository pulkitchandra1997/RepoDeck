const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const profile = await fs.mkdtemp(path.resolve('.tools/recovery-profile-'));
  const settingsPath = path.join(profile, 'settings.json');
  const original = Buffer.from('{corrupt settings');
  await fs.writeFile(settingsPath, original);
  const executable = path.resolve(process.env.REPODECK_TEST_EXE || 'target/debug/repodeck-desktop.exe');
  const child = spawn(executable, [], { windowsHide: true, env: { ...process.env,
    REPODECK_DATA_DIR: profile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9225',
  }, stdio: 'pipe' });
  let failure;
  child.on('error', error => failure = error);
  let browser;
  try {
    for (let attempt = 0; attempt < 40; attempt++) {
      if (failure) throw failure;
      if (child.exitCode !== null) throw new Error(`Desktop exited with code ${child.exitCode}`);
      try { browser = await chromium.connectOverCDP('http://127.0.0.1:9225'); break; }
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
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.getByRole('heading', { name: 'Settings unavailable', exact: true }).waitFor();
    if (process.env.REPODECK_TEST_EXE) assert.ok(!page.url().includes(':1420'), 'Packaged app uses dev server');
    assert.deepEqual(await fs.readFile(settingsPath), original);
    await page.getByRole('button', { name: 'Reset preferences', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel reset', exact: true }).click();
    assert.deepEqual(await fs.readFile(settingsPath), original);
    await page.getByRole('button', { name: 'Reset preferences', exact: true }).click();
    await fs.mkdir('.tools/screenshots', { recursive: true });
    await page.screenshot({ path: '.tools/screenshots/native-recovery.png' });
    for (const width of [800, 600]) {
      await page.setViewportSize({ width, height: 600 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Recovery layout overflows horizontally');
      await page.screenshot({ path: `.tools/screenshots/native-recovery-${width}.png` });
    }
    await page.getByRole('button', { name: 'Back up and reset preferences', exact: true }).click();
    await page.getByRole('button', { name: 'Skip tour', exact: true }).click();
    await page.getByRole('heading', { name: 'Your workspaces', exact: true }).waitFor();
    const backups = (await fs.readdir(profile)).filter(name => name.startsWith('settings.backup-'));
    assert.equal(backups.length, 1);
    assert.deepEqual(await fs.readFile(path.join(profile, backups[0])), original);
    const saved = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    assert.equal(saved.schemaVersion, 1);
    assert.deepEqual(saved.workspaces, []);
    await page.getByRole('status').filter({ hasText: backups[0] }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: 'Your workspaces', exact: true }).waitFor();
    assert.deepEqual(pageErrors, []);
    console.log(`Native recovery passed (${page.url()}): corrupt startup, canceled reset, confirmed backup/reset, persisted defaults and webview reload. Profile: ${profile}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (child.exitCode === null) child.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
