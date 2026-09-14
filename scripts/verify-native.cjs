const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

(async () => {
  const profile = path.resolve('.tools/native-smoke-profile');
  await fs.mkdir(profile, { recursive: true });
  const watchRoot = path.join(profile, 'watch-fixture');
  await fs.mkdir(watchRoot, { recursive: true });
  const reuseProfile = process.env.REPODECK_REUSE_PROFILE === '1';
  const existing = reuseProfile ? JSON.parse(await fs.readFile(path.join(profile, 'settings.json'), 'utf8')) : null;
  const id = existing?.workspaces[0]?.id || randomUUID();
  if (!reuseProfile) await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({
    schemaVersion: 1, onboardingCompleted: true, workspaces: [
      { id, name: 'Express', rootPath: path.resolve('.tools/fixtures/express') },
      { id: randomUUID(), name: 'Flask', rootPath: path.resolve('.tools/fixtures/flask') },
      { id: randomUUID(), name: 'GitLab CLI', rootPath: path.resolve('.tools/fixtures/gitlab-cli') },
      { id: randomUUID(), name: 'Watch Fixture', rootPath: watchRoot },
    ],
    theme: 'light', maxDepth: 12, maxEntries: 50000, excluded: ['.git', 'node_modules'], showHidden: false, editor: 'code',
  }));
  const executable = path.resolve(process.env.REPODECK_TEST_EXE || 'target/debug/repodeck-desktop.exe');
  const child = spawn(executable, [], { windowsHide: true, env: { ...process.env,
    REPODECK_DATA_DIR: profile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9224',
  }, stdio: 'pipe' });
  let stderr = '';
  child.stderr.on('data', chunk => stderr += chunk);
  let browser;
  try {
    for (let attempt = 0; attempt < 40; attempt++) {
      if (child.exitCode !== null) throw new Error(`Desktop exited: ${stderr}`);
      try { browser = await chromium.connectOverCDP('http://127.0.0.1:9224'); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 500)); }
    }
    if (!browser) throw new Error(`WebView2 debugging endpoint unavailable: ${stderr}`);
    let page;
    for (let attempt = 0; attempt < 40; attempt++) {
      page = browser.contexts().flatMap(context => context.pages())[0];
      if (page) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!page) throw new Error('No desktop webview');
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.getByRole('heading', { name: 'Express', exact: true }).waitFor({ timeout: 30000 });
    if (reuseProfile) {
      if (existing.theme !== 'dark' || existing.workspaces.length !== 4) throw new Error('Reused profile does not contain prior smoke preferences');
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    }
    if (process.env.REPODECK_TEST_EXE && page.url().includes(':1420')) throw new Error('Installed app depends on development server');
    await page.getByRole('button', { name: /Express.*master|Express.*main/ }).click();
    if (process.env.REPODECK_TEST_TERMINAL) {
      const run = require('node:util').promisify(require('node:child_process').execFile);
      const output = path.join(profile, 'terminal-output.txt');
      for (const terminal of ['powershell', 'cmd']) {
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('dialog').getByLabel('Terminal').selectOption(terminal);
      await page.getByRole('button', { name: 'Save settings', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      if (JSON.parse(await fs.readFile(path.join(profile, 'settings.json'), 'utf8')).terminal !== terminal) throw new Error('Terminal choice was not persisted');
      await page.getByRole('button', { name: /Express.*master|Express.*main/ }).click();
      await page.getByRole('button', { name: 'Open repository in terminal', exact: true }).click();
      let pid;
      for (let attempt = 0; attempt < 20; attempt++) {
        const result = await run('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "ParentProcessId = ${child.pid}" | Where-Object Name -eq '${terminal}.exe' | Select-Object -ExpandProperty ProcessId`], { windowsHide: true, timeout: 10000 });
        const pids = result.stdout.trim().split(/\s+/).filter(Boolean);
        if (pids.length > 1) throw new Error('Multiple terminal children; refusing ambiguous cleanup');
        if (pids.length === 1) { pid = Number(pids[0]); break; }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      if (!Number.isInteger(pid) || pid <= 0) throw new Error(`${terminal} terminal did not start`);
      try {
        let contents = '';
        let consoleError;
        const prompt = `${terminal === 'powershell' ? 'PS ' : ''}${path.resolve('.tools/fixtures/express')}>`;
        for (let attempt = 0; attempt < 20; attempt++) {
          try { await run(process.env.REPODECK_TEST_TERMINAL, [String(pid), output], { windowsHide: true, timeout: 10000 }); }
          catch (error) { consoleError = error; await new Promise(resolve => setTimeout(resolve, 250)); continue; }
          contents = await fs.readFile(output, 'utf8');
          if (contents.includes(prompt)) break;
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        if (!contents.includes(prompt)) throw new Error(`Terminal prompt does not show the repository working directory${contents ? '' : `: ${consoleError || 'empty buffer'}`}`);
        await run(process.env.REPODECK_TEST_TERMINAL, [String(pid), output, '--input-test'], { windowsHide: true, timeout: 10000 });
        for (let attempt = 0; attempt < 20; attempt++) {
          await run(process.env.REPODECK_TEST_TERMINAL, [String(pid), output], { windowsHide: true, timeout: 10000 });
          contents = await fs.readFile(output, 'utf8');
          if (contents.split('314159265358').length >= 3) break;
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        if (contents.split('314159265358').length < 3) throw new Error(`${terminal} did not execute the interactive echo command`);
        console.log(`Real ${terminal} console matched the Express directory and executed interactive input.`);
      } finally { process.kill(pid); }
      }
    }
    await page.getByRole('button', { name: 'Open remote in browser', exact: true }).click();
    const browserUrl = page.getByLabel('Browser URL', { exact: true });
    await browserUrl.waitFor();
    if (await browserUrl.inputValue() !== 'https://github.com/expressjs/express') throw new Error('Unexpected native remote browser target');
    await page.setViewportSize({ width: 800, height: 600 });
    await browserUrl.scrollIntoViewIfNeeded();
    const remoteOverflow = await page.evaluate(() => {
      const root = document.documentElement;
      const panel = document.querySelector('.remote-link');
      return root.scrollWidth > root.clientWidth || panel.scrollWidth > panel.clientWidth;
    });
    if (remoteOverflow) throw new Error('Remote confirmation overflows at 800px');
    await fs.mkdir('.tools/screenshots', { recursive: true });
    await page.screenshot({ path: '.tools/screenshots/native-remote-800.png' });
    await page.setViewportSize({ width: 1280, height: 820 });
    await browserUrl.fill('file:///tmp/repodeck-must-not-open');
    await page.getByRole('button', { name: 'Open confirmed URL', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: /Only credential-free|repository path/ }).waitFor();
    await browserUrl.fill('https://github.com/expressjs/express');
    if (process.env.REPODECK_TEST_BROWSER === '1') {
      const http = require('node:http');
      let observed;
      const received = new Promise(resolve => { observed = resolve; });
      const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.end('RepoDeck browser launch test passed. This tab can be closed.');
        if (request.url === '/repodeck-browser-test') observed();
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      let timer;
      try {
        await browserUrl.fill(`http://127.0.0.1:${server.address().port}/repodeck-browser-test`);
        await page.getByRole('button', { name: 'Open confirmed URL', exact: true }).click();
        await Promise.race([received, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Default browser did not request the local test page')), 15000); })]);
        console.log('Default OS browser requested the local launch-test page.');
      } finally {
        clearTimeout(timer);
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
      }
    } else {
      await page.getByRole('button', { name: 'Cancel opening remote', exact: true }).click();
    }
    await page.getByRole('tab', { name: 'Repositories', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await page.getByRole('tabpanel', { name: 'Files', exact: true }).waitFor();
    await page.keyboard.press('End');
    await page.getByRole('tabpanel', { name: 'Agents', exact: true }).waitFor();
    await page.keyboard.press('Home');
    await page.getByRole('tabpanel', { name: 'Repositories', exact: true }).waitFor();
    await page.evaluate(() => {
      window.__scanMessages = [];
      const status = document.querySelector('[role="status"]');
      const observer = new MutationObserver(() => window.__scanMessages.push(status.textContent));
      observer.observe(status, { childList: true, characterData: true, subtree: true });
      window.__stopProgressObserver = () => observer.disconnect();
    });
    await page.getByRole('button', { name: 'Refresh workspace', exact: true }).click();
    await page.getByRole('button', { name: 'Stop scan', exact: true }).waitFor({ state: 'detached' });
    const streamed = await page.evaluate(() => { window.__stopProgressObserver(); return window.__scanMessages; });
    if (!streamed.some(message => /entries discovered|repositories inspected/.test(message))) throw new Error(`No native scan progress reached the UI: ${JSON.stringify(streamed)}`);
    await page.getByRole('button', { name: 'Refresh workspace', exact: true }).click();
    await page.getByRole('button', { name: 'Stop scan', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Scan cancelled' }).waitFor();
    await page.getByRole('button', { name: 'Refresh workspace', exact: true }).click();
    await page.getByRole('button', { name: 'Stop scan', exact: true }).waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Hooks and LFS', exact: true }).click();
    await page.getByRole('heading', { name: 'Hook files', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'LFS attribute declarations', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Hooks and LFS', exact: true }).click();
    await page.getByRole('button', { name: 'Git configuration', exact: true }).click();
    await page.getByText('core.repositoryformatversion', { exact: true }).waitFor();
    await page.getByLabel('Repository-relative path').fill('repodeck-test.log');
    await page.getByRole('button', { name: 'Check ignore rule', exact: true }).click();
    await page.getByText('.gitignore:5', { exact: true }).waitFor();
    await page.getByText('*.log', { exact: true }).waitFor();
    await page.getByRole('tab', { name: 'Files', exact: true }).click();
    await page.getByRole('button', { name: /^lib,/ }).click();
    await page.getByRole('button', { name: /^lib\/application.js,/ }).click();
    await page.locator('pre').filter({ hasText: 'exports' }).waitFor();
    await page.getByRole('textbox', { name: 'Filter workspace' }).fill('package.json');
    await page.getByRole('button', { name: /^package.json/ }).click();
    await page.locator('pre').filter({ hasText: '"name": "express"' }).waitFor();
    const packageStat = await fs.stat(path.resolve('.tools/fixtures/express/package.json'));
    const renderedTimestamp = await page.locator('.file-row[aria-current="true"] time').getAttribute('datetime');
    if (renderedTimestamp !== new Date(packageStat.mtimeMs).toISOString()) throw new Error('Displayed modified date does not match filesystem metadata');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const preferencesBeforeInvalidSave = await fs.readFile(path.join(profile, 'settings.json'), 'utf8');
    await page.getByLabel('Scan depth', { exact: true }).fill('0');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.getByRole('dialog').getByRole('alert').filter({ hasText: 'Invalid theme or scan limits' }).waitFor();
    if (await fs.readFile(path.join(profile, 'settings.json'), 'utf8') !== preferencesBeforeInvalidSave) throw new Error('Invalid settings replaced persisted preferences');
    await page.getByLabel('Scan depth', { exact: true }).fill('12');
    await page.getByLabel('Editor application', { exact: true }).fill('code.cmd');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.getByRole('dialog').getByRole('alert').filter({ hasText: 'Choose an editor application or executable, not a shell script' }).waitFor();
    if (await fs.readFile(path.join(profile, 'settings.json'), 'utf8') !== preferencesBeforeInvalidSave) throw new Error('Invalid editor replaced persisted preferences');
    await page.getByLabel('Editor application', { exact: true }).fill('code');
    await page.getByLabel('Appearance').selectOption('dark');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Settings saved' }).waitFor();
    const saved = JSON.parse(await fs.readFile(path.join(profile, 'settings.json'), 'utf8'));
    if (saved.theme !== 'dark' || saved.workspaces[0].id !== id) throw new Error('Native preferences were not persisted');
    if (process.env.REPODECK_TEST_EDITOR) {
      const output = process.env.REPODECK_EDITOR_PROBE;
      if (!output) throw new Error('Set REPODECK_EDITOR_PROBE for the editor test');
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByLabel('Editor application', { exact: true }).fill(path.join(profile, 'missing-editor.exe'));
      await page.getByRole('button', { name: 'Save settings', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      await page.getByRole('button', { name: 'Open file in editor', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'Could not launch the editor' }).waitFor();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByLabel('Editor application', { exact: true }).fill(process.env.REPODECK_TEST_EDITOR);
      await page.getByRole('button', { name: 'Save settings', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      for (const [control, expected] of [
        ['Open repository in editor', path.resolve('.tools/fixtures/express')],
        ['Open file in editor', path.resolve('.tools/fixtures/express/package.json')],
      ]) {
        await fs.rm(output, { force: true });
        await page.getByRole('tab', { name: control === 'Open repository in editor' ? 'Repositories' : 'Files', exact: true }).click();
        await page.getByRole('button', { name: control, exact: true }).click();
        let actual;
        for (let attempt = 0; attempt < 40; attempt++) {
          try { actual = await fs.readFile(output, 'utf8'); break; }
          catch { await new Promise(resolve => setTimeout(resolve, 100)); }
        }
        if (actual?.replace(/^\\\\\?\\/, '') !== expected) throw new Error(`Incorrect editor argument: ${JSON.stringify(actual)}`);
      }
      console.log('Native editor probe received the repository and file paths as single arguments; missing editor error passed.');
    }
    if (process.env.REPODECK_REAL_EDITOR === '1') {
      const executable = process.env.REPODECK_CODE_EXE;
      const cli = process.env.REPODECK_CODE_CLI;
      if (!executable || !cli) throw new Error('Set REPODECK_CODE_EXE and REPODECK_CODE_CLI for the VS Code check');
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByLabel('Editor application', { exact: true }).fill('code');
      await page.getByRole('button', { name: 'Save settings', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      const editorFile = `repodeck-editor-${randomUUID()}.txt`;
      await fs.writeFile(path.join(watchRoot, editorFile), 'RepoDeck editor smoke test\n');
      await page.getByRole('navigation', { name: 'Workspaces' }).getByRole('button', { name: 'Watch Fixture', exact: true }).click();
      await page.getByRole('tab', { name: 'Files', exact: true }).click();
      await page.getByRole('textbox', { name: 'Filter workspace' }).fill(editorFile);
      await page.getByRole('button', { name: new RegExp(`^${editorFile.replace('.', '\\.')},`) }).click();
      await page.locator('pre').filter({ hasText: 'RepoDeck editor smoke test' }).waitFor();
      await page.getByRole('button', { name: 'Open file in editor', exact: true }).click();
      const run = require('node:util').promisify(require('node:child_process').execFile);
      const windowPattern = new RegExp(`window.*${editorFile.replace('.', '\\.')}`, 'i');
      let status = '';
      for (let attempt = 0; attempt < 10; attempt++) {
        if (await page.getByRole('alert').filter({ hasText: 'Could not launch the editor' }).count()) throw new Error('Native default-editor launch failed');
        const result = await run(executable, [cli, '--status'], {
          windowsHide: true, timeout: 10000,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', VSCODE_DEV: '' },
        });
        status = result.stdout;
        if (windowPattern.test(status)) break;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      if (!windowPattern.test(status)) throw new Error(`VS Code did not report the unique test-file window: ${status}`);
      console.log(`VS Code reported the unique ${editorFile} window after native Open file in editor.`);
      await page.getByRole('navigation', { name: 'Workspaces' }).getByRole('button', { name: 'Express', exact: true }).click();
      await page.getByRole('tab', { name: 'Files', exact: true }).click();
      await page.getByRole('textbox', { name: 'Filter workspace' }).fill('package.json');
      await page.getByRole('button', { name: /^package.json,/ }).click();
      await page.locator('pre').filter({ hasText: '"name": "express"' }).waitFor();
    }
    await fs.mkdir('.tools/screenshots', { recursive: true });
    await page.screenshot({ path: '.tools/screenshots/native-express.png' });
    for (const project of [
      { name: 'Flask', file: 'pyproject.toml', content: 'name = "Flask"', image: 'flask' },
      { name: 'GitLab CLI', file: 'go.mod', content: 'module gitlab.com/gitlab-org/cli', image: 'gitlab-cli' },
    ]) {
      await page.getByRole('navigation', { name: 'Workspaces' }).getByRole('button', { name: project.name, exact: true }).click();
      await page.getByRole('heading', { name: project.name, exact: true }).waitFor();
      await page.getByRole('tab', { name: 'Repositories', exact: true }).click();
      await page.getByRole('button', { name: new RegExp(`${project.name}.*(?:master|main)`) }).click();
      await page.locator('.repo-row.selected').getByText('Clean', { exact: true }).waitFor();
      await page.getByRole('tab', { name: 'Files', exact: true }).click();
      await page.getByRole('textbox', { name: 'Filter workspace' }).fill(project.file);
      await page.getByRole('button', { name: new RegExp(`^${project.file.replace('.', '\\.')}[,]`) }).click();
      await page.locator('pre').filter({ hasText: project.content }).waitFor();
      await page.screenshot({ path: `.tools/screenshots/native-${project.image}.png` });
    }
    if (pageErrors.length) throw new Error(`Webview errors: ${pageErrors.join('; ')}`);
    await page.getByRole('navigation', { name: 'Workspaces' }).getByRole('button', { name: 'Watch Fixture', exact: true }).click();
    await page.getByRole('tab', { name: 'Files', exact: true }).click();
    await page.getByRole('button', { name: 'Pause automatic refresh', exact: true }).waitFor();
    const watchName = `agent-result-${randomUUID()}.txt`;
    const watchPath = path.join(watchRoot, watchName);
    const watchedFile = page.getByRole('button', { name: new RegExp(`^${watchName},`) });
    try {
      await fs.writeFile(watchPath, 'first');
      await watchedFile.waitFor({ timeout: 15000 });
      await watchedFile.click();
      await page.locator('pre').filter({ hasText: 'first' }).waitFor();
      await fs.writeFile(watchPath, 'updated by another agent');
      await page.getByRole('button', { name: `${watchName}, 24 B`, exact: true }).waitFor({ timeout: 15000 });
      await page.locator('pre').filter({ hasText: 'updated by another agent' }).waitFor();
      await fs.unlink(watchPath);
      await watchedFile.waitFor({ state: 'detached', timeout: 15000 });
      await page.locator('pre').filter({ hasText: 'updated by another agent' }).waitFor({ state: 'detached' });
      await page.getByRole('button', { name: 'Pause automatic refresh', exact: true }).click();
      await page.getByRole('button', { name: 'Resume automatic refresh', exact: true }).waitFor();
      if (JSON.parse(await fs.readFile(path.join(profile, 'settings.json'), 'utf8')).autoRefresh !== false) throw new Error('Automatic refresh pause was not persisted');
      await page.getByRole('button', { name: 'Stop scan', exact: true }).waitFor({ state: 'detached' });
      await fs.writeFile(watchPath, 'while paused');
      await page.waitForTimeout(1600);
      if (await watchedFile.count()) throw new Error('Paused watcher refreshed the workspace');
      await page.getByRole('button', { name: 'Resume automatic refresh', exact: true }).click();
      await watchedFile.waitFor({ timeout: 15000 });
      await fs.unlink(watchPath);
      await watchedFile.waitFor({ state: 'detached', timeout: 15000 });
    } finally {
      await fs.unlink(watchPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
    await page.getByRole('button', { name: 'Pause automatic refresh', exact: true }).click();
    await page.getByRole('button', { name: 'Resume automatic refresh', exact: true }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: 'Resume automatic refresh', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Resume automatic refresh', exact: true }).click();
    await page.getByRole('button', { name: 'Pause automatic refresh', exact: true }).waitFor();
    if (JSON.parse(await fs.readFile(path.join(profile, 'settings.json'), 'utf8')).autoRefresh !== true) throw new Error('Automatic refresh resume was not persisted');
    if (process.env.REPODECK_TEST_SUBMODULE === '1') {
      const run = require('node:util').promisify(require('node:child_process').execFile);
      const source = await fs.mkdtemp(path.join(profile, 'submodule-source-'));
      const project = await fs.mkdtemp(path.join(watchRoot, 'submodule-project-'));
      const git = (root, args) => run('git', ['-c', 'core.hooksPath=', '-c', 'commit.gpgSign=false',
        '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-C', root, ...args], { windowsHide: true, timeout: 30000 });
      try {
        await git(source, ['init', '--initial-branch=main']);
        await fs.writeFile(path.join(source, 'library.txt'), 'Original library\n');
        await git(source, ['add', 'library.txt']);
        await git(source, ['commit', '-m', 'Fixture']);
        await git(project, ['init', '--initial-branch=main']);
        await git(project, ['-c', 'protocol.file.allow=always', 'submodule', 'add', source, 'deps/library']);
        await git(project, ['commit', '-m', 'Submodule fixture']);
        const childRoot = path.join(project, 'deps', 'library');
        await git(childRoot, ['checkout', '--detach', 'HEAD']);
        await fs.writeFile(path.join(childRoot, 'library.txt'), 'Changed library\n');
        await page.getByRole('navigation', { name: 'Workspaces' }).getByRole('button', { name: 'Watch Fixture', exact: true }).click();
        await page.getByRole('tab', { name: 'Repositories', exact: true }).click();
        const relative = `${path.basename(project)}/deps/library`;
        await page.getByRole('button', { name: new RegExp(`${relative}.*Detached HEAD.*1 change`) }).click({ timeout: 20000 });
        await page.locator('.change-row').getByRole('button', { name: /library.txt/ }).click();
        await page.locator('pre').filter({ hasText: '+Changed library' }).waitFor();
        await page.setViewportSize({ width: 800, height: 820 });
        if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Submodule view overflows');
        await page.screenshot({ path: '.tools/screenshots/native-submodule.png' });
        await page.getByRole('tab', { name: 'Files', exact: true }).click();
        await page.getByRole('textbox', { name: 'Filter workspace' }).fill(`${relative}/library.txt`);
        await page.getByRole('button', { name: new RegExp(`^${relative}/library.txt,`) }).click();
        await page.locator('pre').filter({ hasText: 'Changed library' }).waitFor();
        console.log('Installed detached submodule shows branch state, change count, real diff and file preview.');
      } finally {
        if (path.dirname(project) !== watchRoot || path.dirname(source) !== profile) throw new Error('Unexpected submodule fixture path');
        await fs.rm(project, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 });
        await fs.rm(source, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 });
      }
    }
    if (process.env.REPODECK_TEST_WORKTREE === '1') {
      const run = require('node:util').promisify(require('node:child_process').execFile);
      const source = await fs.mkdtemp(path.join(profile, 'worktree-source-'));
      const worktree = await fs.mkdtemp(path.join(watchRoot, 'agent-worktree-'));
      const name = path.basename(worktree);
      const git = (root, args) => run('git', ['-c', 'core.hooksPath=', '-c', 'commit.gpgSign=false',
        '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-C', root, ...args], { windowsHide: true, timeout: 30000 });
      try {
        await page.getByRole('navigation', { name: 'Workspaces' }).getByRole('button', { name: 'Watch Fixture', exact: true }).click();
        await page.getByRole('tab', { name: 'Repositories', exact: true }).click();
        await git(source, ['init', '--initial-branch=main']);
        await git(source, ['commit', '--allow-empty', '-m', 'Fixture']);
        await git(source, ['worktree', 'add', '-b', 'agent', worktree]);
        await page.getByRole('button', { name: new RegExp(`${name}.*agent.*Clean`) }).waitFor({ timeout: 20000 });
        await page.waitForFunction(() => document.querySelector('[aria-label="Pause automatic refresh"]')?.getAttribute('title') === 'Automatic refresh active');
        await git(worktree, ['symbolic-ref', 'HEAD', 'refs/heads/next']);
        await page.getByRole('button', { name: new RegExp(`${name}.*next.*Clean`) }).waitFor({ timeout: 15000 });
        await page.setViewportSize({ width: 800, height: 600 });
        await page.screenshot({ path: '.tools/screenshots/native-worktree.png' });
        console.log('Newly discovered worktree refreshed after an external HEAD-only change.');
      } finally {
        if (path.dirname(worktree) !== watchRoot || path.dirname(source) !== profile) throw new Error('Unexpected worktree fixture path');
        await git(source, ['worktree', 'remove', '--force', worktree]).catch(() => {});
        await fs.rm(worktree, { recursive: true, force: true });
        await fs.rm(source, { recursive: true, force: true });
      }
    }
    if (process.env.REPODECK_TEST_JUNCTION === '1') {
      const external = await fs.mkdtemp(path.join(profile, 'external-junction-'));
      const linkName = `linked-${randomUUID()}`;
      const link = path.join(watchRoot, linkName);
      const externalFile = path.join(external, 'outside-only.txt');
      await fs.writeFile(externalFile, 'Outside workspace; must not be scanned');
      try {
        await page.getByRole('navigation', { name: 'Workspaces' }).getByRole('button', { name: 'Watch Fixture', exact: true }).click();
        await page.getByRole('tab', { name: 'Files', exact: true }).click();
        await fs.symlink(external, link, 'junction');
        await page.locator('.warnings summary').waitFor({ timeout: 15000 });
        await page.locator('.warnings summary').click();
        await page.getByText(`Linked entry not followed: ${linkName}`, { exact: true }).waitFor();
        await page.getByRole('textbox', { name: 'Filter workspace' }).fill('outside-only');
        await page.getByText('No files match your filter.', { exact: true }).waitFor();
        if (await fs.readFile(externalFile, 'utf8') !== 'Outside workspace; must not be scanned') throw new Error('External junction contents changed');
        await page.setViewportSize({ width: 800, height: 600 });
        await page.screenshot({ path: '.tools/screenshots/native-junction.png' });
        console.log('Installed junction scan reported skipped contents without indexing the external file.');
      } finally {
        await fs.rmdir(link).catch(error => { if (error.code !== 'ENOENT') throw error; });
        await fs.unlink(externalFile);
        await fs.rmdir(external);
      }
    }
    if (pageErrors.length) throw new Error(`Webview errors: ${pageErrors.join('; ')}`);
    console.log(`Native WebView2 smoke passed (${page.url()}): progress, cancellation/restart, hooks/LFS, Git settings, ignore rules, Express/Flask/GitLab CLI files, keyboard navigation, settings validation, workspace switching, persisted theme and automatic create/edit/delete refresh with pause/resume; no page errors.`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (child.exitCode === null) child.kill();
  }
})().catch(error => { console.error(error); process.exit(1); });
