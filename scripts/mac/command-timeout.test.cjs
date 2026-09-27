const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');

function load(file, execute) {
  const filename = path.join(__dirname, file);
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  const requireMock = name => name === 'node:child_process'
    ? { ...localRequire(name), spawnSync: execute } : localRequire(name);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { require: requireMock, module, process, console, __dirname }, { filename });
  return module.exports;
}

for (const file of ['hosted-preview-smoke.cjs', 'validate-dmg.cjs']) {
  test(`${file} hard-stops its timed-out command and reports failure`, () => {
    let invoked = false;
    const api = load(file, (command, args, options) => {
      invoked = true;
      // Fail before launching if the production signal regresses: never hang the test.
      assert.equal(options.killSignal, 'SIGKILL');
      assert.equal(options.timeout, 120000);
      assert.ok(options.maxBuffer > 0);
      assert.ok(!options.shell);
      const result = spawnSync(command, args, { ...options, timeout: 1000 });
      assert.equal(result.error?.code, 'ETIMEDOUT');
      assert.match(result.stdout, /ready/);
      if (process.platform !== 'win32') assert.equal(result.signal, 'SIGKILL');
      return result;
    });
    const evidence = { commands: [] };
    const execute = file === 'validate-dmg.cjs' ? api.defaultExecute : api.commandRunner(evidence);
    assert.throws(() => execute(process.execPath, ['-e', "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)"]), /ETIMEDOUT/);
    assert.equal(invoked, true);
    if (file === 'hosted-preview-smoke.cjs') assert.match(evidence.commands[0].error, /ETIMEDOUT/);
  });
}
