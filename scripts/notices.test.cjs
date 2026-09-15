const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { generateNotices, TARGETS } = require('./generate-notices.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repodeck-notices-'));
  t.after(async () => {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('repodeck-notices-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const write = async (file, value) => {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), typeof value === 'string' ? value : JSON.stringify(value));
  };
  const packages = { '': { dependencies: { '@fixture/ui': '1.0.0' } } };
  const npm = async (name, extra = {}, location = `node_modules/${name}`) => {
    const pkg = { name, version: '1.0.0', license: 'MIT', ...extra };
    packages[location] = pkg;
    await write(`${location}/package.json`, pkg);
    await write(`${location}/LICENSE`, `Fixture license for ${name}\n`);
  };
  await npm('@fixture/ui', { dependencies: { shared: '1.0.0' } });
  await npm('shared');
  await npm('dev-only', { dev: true });
  const save = async () => {
    await write('package-lock.json', { lockfileVersion: 3, packages });
    await write('package.json', packages['']);
  };
  await save();
  await write('crate/LICENSE-MIT', 'Fixture crate license\n');
  await write('crate/NOTICE', 'Fixture attribution\n');
  const metadata = target => ({
    version: 1,
    workspace_members: ['app'],
    packages: [
      { id: 'app', name: 'repodeck-desktop', version: '0.1.0', manifest_path: path.join(root, 'src-tauri/Cargo.toml') },
      { id: 'crate', name: target === TARGETS[0] ? 'windows-crate' : 'mac-crate', version: '2.0.0', license: 'MIT', manifest_path: path.join(root, 'crate/Cargo.toml') },
      { id: 'unused', name: 'unused', version: '1.0.0' },
    ],
    resolve: { nodes: [
      { id: 'app', deps: [{ pkg: 'crate', dep_kinds: [{ kind: null, target: null }] }, { pkg: 'unused', dep_kinds: [{ kind: 'dev' }] }] },
      { id: 'crate', deps: [] },
    ] },
  });
  return { root, write, packages, npm, save, metadata, run: () => generateNotices({ root, metadata }) };
}

test('combines scoped production closure and target graphs, retaining actual texts deterministically', async t => {
  const f = await fixture(t);
  const first = await f.run();
  const doc = JSON.parse(first);
  assert.deepEqual(doc.targets, TARGETS);
  assert.deepEqual(doc.packages.map(p => p.name).sort(), ['@fixture/ui', 'mac-crate', 'shared', 'windows-crate']);
  assert.equal(doc.packages.find(p => p.name === '@fixture/ui').texts[0].text, 'Fixture license for @fixture/ui\n');
  assert.equal(doc.packages.find(p => p.name === 'windows-crate').texts.length, 2);
  assert.deepEqual(doc.packages.find(p => p.name === 'mac-crate').targets, TARGETS.slice(1).sort());
  assert.ok(!first.includes(f.root));
  assert.ok(!first.includes('manifest_path'));
  const metadata = target => {
    const m = f.metadata(target);
    m.packages.reverse();
    m.resolve.nodes.reverse();
    return m;
  };
  assert.equal(first, await generateNotices({ root: f.root, metadata }));
});

test('missing or empty license text fails closed even with a NOTICE', async t => {
  const f = await fixture(t);
  await fs.rm(path.join(f.root, 'crate/LICENSE-MIT'));
  await assert.rejects(f.run(), /license text/i);
  await f.write('crate/LICENSE-MIT', '');
  await assert.rejects(f.run(), /empty/i);
});

test('missing and custom license declarations require review', async t => {
  const f = await fixture(t);
  for (const license of [null, 'LicenseRef-Custom', 'SEE LICENSE IN LICENSE', 'MIT OR Unknown']) {
    await assert.rejects(generateNotices({ root: f.root, metadata: target => {
      const m = f.metadata(target);
      m.packages[1].license = license;
      return m;
    } }), /license identifier/i);
  }
});

test('retains a standard compound declaration and declared nested license text', async t => {
  const f = await fixture(t);
  await f.write('crate/legal/terms.txt', 'Exact declared fixture terms\r\n');
  const output = JSON.parse(await generateNotices({ root: f.root, metadata: target => {
    const m = f.metadata(target);
    m.packages[1].license = 'CC0-1.0 OR MIT-0 OR Apache-2.0';
    m.packages[1].license_file = 'legal/terms.txt';
    return m;
  } }));
  const pkg = output.packages.find(p => p.name === 'windows-crate');
  assert.equal(pkg.license, 'CC0-1.0 OR MIT-0 OR Apache-2.0');
  assert.ok(pkg.texts.some(text => text.text === 'Exact declared fixture terms\r\n'));
});

test('recognizes current dependency SPDX expressions and Cargo legacy separators without changing declarations', async t => {
  const f = await fixture(t);
  for (const license of ['0BSD OR MIT OR Apache-2.0', 'Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT', 'Apache-2.0 / MIT', 'BSD-3-Clause/MIT', 'MIT/Apache-2.0', 'Unlicense/MIT', '(MIT OR Apache-2.0) AND Unicode-3.0']) {
    const doc = JSON.parse(await generateNotices({ root: f.root, metadata: target => {
      const m = f.metadata(target);
      m.packages[1].license = license;
      return m;
    } }));
    assert.equal(doc.packages.find(p => p.name === 'windows-crate').license, license);
  }
});

test('missing final target and oversized text fail the entire collection', async t => {
  const f = await fixture(t);
  await assert.rejects(generateNotices({ root: f.root, metadata: target => target === TARGETS[2] ? null : f.metadata(target) }), /Cargo metadata/);
  await f.write('crate/NOTICE', 'x'.repeat(2 * 1024 * 1024 + 1));
  await assert.rejects(f.run(), /bounded regular file/);
});

test('missing installed production dependency and version drift fail', async t => {
  const f = await fixture(t);
  await f.write('node_modules/shared/package.json', { name: 'shared', version: '9.0.0', license: 'MIT' });
  await assert.rejects(f.run(), /installed package/i);
  await fs.rm(path.join(f.root, 'node_modules/shared'), { recursive: true });
  await assert.rejects(f.run(), /installed package/i);
});

test('nested dependency resolution and installed peers are included', async t => {
  const f = await fixture(t);
  await f.npm('@fixture/ui', { dependencies: { shared: '2.0.0' } });
  await f.npm('shared', { version: '2.0.0', peerDependencies: { peer: '*' } }, 'node_modules/@fixture/ui/node_modules/shared');
  await f.npm('peer');
  await f.save();
  const packages = JSON.parse(await f.run()).packages;
  assert.equal(packages.find(p => p.name === 'shared').version, '2.0.0');
  assert.ok(packages.some(p => p.name === 'peer'));
});

test('unlocked installed shadows and incompatible locked resolutions fail closed', async t => {
  const f = await fixture(t);
  await f.write('node_modules/@fixture/ui/node_modules/shared/package.json', { name: 'shared', version: '2.0.0' });
  await assert.rejects(f.run(), /shadow|lockfile/i);
  await f.npm('shared', { version: '2.0.0' }, 'node_modules/@fixture/ui/node_modules/shared');
  await f.save();
  await assert.rejects(f.run(), /range|version constraint/i);
});

test('cumulative notice size fails before reading later packages', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 10; i++) {
    await f.write(`crate/NOTICE-${i}`, '\u0001'.repeat(700000));
  }
  let targetsRead = 0;
  await assert.rejects(generateNotices({ root: f.root, metadata: target => {
    targetsRead++;
    return f.metadata(target);
  } }), /aggregate notice/i);
  assert.equal(targetsRead, 1);
});

test('peer declarations cannot overwrite an incompatible dependency constraint', async t => {
  const f = await fixture(t);
  await f.npm('@fixture/ui', { dependencies: { shared: '2.0.0' }, peerDependencies: { shared: '*' } });
  await f.save();
  await assert.rejects(f.run(), /version constraint/i);
});

test('platform-limited npm dependencies cannot certify the three-target union', async t => {
  const f = await fixture(t);
  await f.npm('shared', { os: ['win32'] });
  await f.save();
  await assert.rejects(f.run(), /platform-specific npm/i);
});

test('private paths in upstream text fail without leaking or rewriting terms', async t => {
  const f = await fixture(t);
  await f.write('crate/NOTICE', `Attribution ${f.root}`);
  await assert.rejects(f.run(), error => /private path/i.test(error.message) && !error.message.includes(f.root));
});

test('license URLs are preserved and private Windows/POSIX paths are rejected', async t => {
  const f = await fixture(t);
  await f.write('crate/NOTICE', 'See https://www.apache.org/licenses/LICENSE-2.0');
  assert.ok((await f.run()).includes('https://www.apache.org/licenses/LICENSE-2.0'));
  for (const text of ['C:/Users/fixture/private', '/home/fixture/private', '/Users/fixture/private', String.raw`\\private-server\confidential-share\project\LICENSE`, '//private-server/confidential-share/project/LICENSE', 'source=//private-server/share/LICENSE', '`//private-server/share/LICENSE`']) {
    await f.write('crate/NOTICE', text);
    await assert.rejects(f.run(), /private path/i);
  }
});

test('Cargo command uses locked offline target metadata with bounds; failures redact stderr', async t => {
  const f = await fixture(t);
  const calls = [];
  await generateNotices({ root: f.root, exec: async (command, args, options) => {
    calls.push(args);
    assert.equal(command, 'cargo');
    assert.equal(options.shell, false);
    assert.ok(options.timeout > 0 && options.maxBuffer > 0);
    return { stdout: JSON.stringify(f.metadata(args.at(-1))) };
  } });
  assert.deepEqual(calls, TARGETS.map(target => ['metadata', '--locked', '--offline', '--format-version', '1', '--filter-platform', target]));
  await assert.rejects(generateNotices({ root: f.root, exec: async () => { throw new Error(f.root); } }), error => /Cargo metadata failed/.test(error.message) && !error.message.includes(f.root));
});

test('incomplete Cargo graph fails and CLI produces no artifact on failure', async t => {
  const f = await fixture(t);
  await assert.rejects(generateNotices({ root: f.root, metadata: () => ({ packages: [], resolve: null }) }), /Cargo metadata/i);
  const output = path.join(f.root, 'notices.json');
  await f.write('package-lock.json', { lockfileVersion: 2 });
  await assert.rejects(promisify(execFile)(process.execPath, [path.join(__dirname, 'generate-notices.cjs'), output], { cwd: f.root }), error => error.code === 1 && !error.stderr.includes(f.root));
  await assert.rejects(fs.access(output));
});
