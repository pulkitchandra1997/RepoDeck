const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createHash } = require('node:crypto');
const { generateNotices, runCli, TARGETS } = require('./generate-notices.cjs');

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

async function fallbackFixture(t) {
  const f = await fixture(t);
  await fs.rm(path.join(f.root, 'crate/LICENSE-MIT'));
  const revision = 'a'.repeat(40);
  const repository = 'https://github.com/fixture/upstream';
  const text = 'Fixture upstream terms\r\nCopyright fixture\r\n';
  const source = { repository, revision, file: 'LICENSE', role: 'license', text,
    sha256: createHash('sha256').update(text).digest('hex') };
  const entry = { name: 'windows-crate', version: '2.0.0', license: 'MIT', repository,
    revision, pathInVcs: 'crate', status: 'text-reviewed', reason: 'Fixture source review only.', sources: [0] };
  const manifest = { schemaVersion: 1, sources: [source], packages: [entry] };
  const saveFallback = () => f.write('scripts/license-fallbacks/manifest.json', manifest);
  await saveFallback();
  await f.write('crate/.cargo_vcs_info.json', { git: { sha1: revision }, path_in_vcs: 'crate' });
  const metadata = target => {
    const m = f.metadata(target);
    Object.assign(m.packages[1], { name: 'windows-crate', repository,
      source: 'registry+https://github.com/rust-lang/crates.io-index' });
    return m;
  };
  return { ...f, manifest, source, entry, saveFallback, metadata,
    run: options => generateNotices({ root: f.root, metadata, ...options }) };
}

test('pinned offline fallback preserves exact text, hash and upstream provenance across targets', async t => {
  const f = await fallbackFixture(t);
  const doc = JSON.parse(await f.run());
  assert.equal(doc.collectionComplete, true);
  const pkg = doc.packages.find(p => p.name === 'windows-crate');
  const evidence = pkg.texts.find(text => text.provenance.kind === 'pinned-upstream');
  assert.equal(evidence.text, f.source.text);
  assert.equal(evidence.sha256, f.source.sha256);
  assert.equal(evidence.provenance.url, `${f.entry.repository}/blob/${f.entry.revision}/LICENSE`);
  assert.ok(pkg.texts.some(text => text.file === 'NOTICE'));
  assert.deepEqual(pkg.targets, [...TARGETS].sort());
});

test('fallback refuses hash, version, declaration, repository and revision drift', async t => {
  const f = await fallbackFixture(t);
  for (const [object, field, value] of [
    [f.source, 'sha256', 'b'.repeat(64)], [f.entry, 'version', '2.0.1'],
    [f.entry, 'license', 'Apache-2.0'], [f.entry, 'repository', 'https://github.com/other/upstream'],
    [f.entry, 'revision', 'b'.repeat(40)], [f.entry, 'pathInVcs', 'other'],
  ]) {
    const previous = object[field];
    object[field] = value;
    await f.saveFallback();
    await assert.rejects(f.run(), /fallback|missing license/i);
    object[field] = previous;
  }
});

test('fallback rejects unsafe paths, mutable revisions, duplicate entries and oversized texts', async t => {
  const f = await fallbackFixture(t);
  for (const file of ['../LICENSE', '/LICENSE', 'C:/LICENSE', 'legal\\LICENSE', 'a/../../LICENSE', 'a//LICENSE']) {
    f.source.file = file;
    await f.saveFallback();
    await assert.rejects(f.run(), /fallback/i);
  }
  f.source.file = 'LICENSE';
  f.source.revision = 'main';
  await f.saveFallback();
  await assert.rejects(f.run(), /fallback/i);
  f.source.revision = f.entry.revision;
  f.manifest.packages.push({ ...f.entry });
  await f.saveFallback();
  await assert.rejects(f.run(), /duplicate fallback/i);
  f.manifest.packages.pop();
  f.source.text = 'x'.repeat(2 * 1024 * 1024 + 1);
  f.source.sha256 = createHash('sha256').update(f.source.text).digest('hex');
  await f.saveFallback();
  await assert.rejects(f.run(), /fallback.*(size|limit)/i);
});

test('blocked upstream terms cannot be cleared by a LICENSE filename; inventory visits all targets', async t => {
  const f = await fallbackFixture(t);
  f.entry.status = 'blocked';
  f.entry.reason = 'Fixture upstream explicitly leaves derived SDK terms unresolved.';
  await f.saveFallback();
  await f.write('crate/LICENSE', 'Fixture local license does not resolve SDK terms');
  await assert.rejects(f.run(), /unresolved.*3 target/i);
  const doc = JSON.parse(await f.run({ inventory: true }));
  assert.equal(doc.collectionComplete, false);
  assert.equal(doc.unresolved.length, 1);
  assert.deepEqual(doc.unresolved[0].targets, [...TARGETS].sort());
  assert.match(doc.unresolved[0].reason, /SDK terms/);
  assert.ok(doc.packages.find(p => p.name === 'windows-crate').texts.some(text => text.sha256 === f.source.sha256));
});

test('inventory retains missing-license packages and never mistakes an incomplete graph for a collection', async t => {
  const f = await fixture(t);
  await fs.rm(path.join(f.root, 'crate/LICENSE-MIT'));
  const doc = JSON.parse(await generateNotices({ root: f.root, metadata: f.metadata, inventory: true }));
  assert.equal(doc.collectionComplete, false);
  assert.equal(doc.unresolved.length, 2);
  assert.equal(doc.packages.length, 4);
  await assert.rejects(generateNotices({ root: f.root, metadata: () => null, inventory: true }), /Cargo metadata/);
});

test('bundle command refuses unresolved evidence and stale output; inventory output stays separate', async t => {
  const f = await fallbackFixture(t);
  const output = path.join(f.root, '.tools/notices/THIRD-PARTY-NOTICES.json');
  const options = { root: f.root, metadata: f.metadata };
  f.entry.status = 'blocked';
  await f.saveFallback();
  await assert.rejects(runCli(['--bundle'], options), /unresolved/i);
  await assert.rejects(fs.access(output));
  await runCli(['--inventory', 'inventory.json'], options);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.root, 'inventory.json'))).collectionComplete, false);
  await f.write('.tools/notices/THIRD-PARTY-NOTICES.json', 'stale');
  await assert.rejects(runCli(['--bundle'], options), /unresolved/i);
  assert.equal(await fs.readFile(output, 'utf8'), 'stale');
  f.entry.status = 'text-reviewed';
  await f.saveFallback();
  await assert.rejects(runCli(['--bundle'], options), /EEXIST/);
  await fs.rm(output);
  await runCli(['--bundle'], options);
  assert.equal(JSON.parse(await fs.readFile(output)).collectionComplete, true);
  await assert.rejects(runCli(['--bundle'], options), /EEXIST/);
  await assert.rejects(runCli(['--bundle', '--inventory'], options), /Usage/);
});

test('fallback and bundle directory links cannot redirect reads or writes', async t => {
  const f = await fallbackFixture(t);
  const fallbackDir = path.join(f.root, 'scripts/license-fallbacks');
  await fs.rename(fallbackDir, path.join(f.root, 'moved-fallbacks'));
  await fs.symlink(path.join(f.root, 'moved-fallbacks'), fallbackDir, 'junction');
  await assert.rejects(f.run(), /Fallback manifest.*linked/i);
  await fs.unlink(fallbackDir);
  await fs.rename(path.join(f.root, 'moved-fallbacks'), fallbackDir);
  const manifestFile = path.join(fallbackDir, 'manifest.json');
  await fs.rename(manifestFile, path.join(fallbackDir, 'saved.json'));
  await fs.mkdir(manifestFile);
  await assert.rejects(f.run(), /Fallback manifest.*regular/i);
  await fs.rmdir(manifestFile);
  await fs.rename(path.join(fallbackDir, 'saved.json'), manifestFile);
  await fs.mkdir(path.join(f.root, 'other'));
  await fs.symlink(path.join(f.root, 'other'), path.join(f.root, '.tools'), 'junction');
  await assert.rejects(runCli(['--bundle'], { root: f.root, metadata: f.metadata }), /linked bundle/i);
  assert.deepEqual(await fs.readdir(path.join(f.root, 'other')), []);
});

test('checked-in upstream evidence validates offline and retains every explicit blocker', async t => {
  const f = await fixture(t);
  const checkedIn = JSON.parse(await fs.readFile(path.join(__dirname, 'license-fallbacks/manifest.json')));
  assert.deepEqual(checkedIn.packages.find(entry => entry.name === 'selectors').sourceOffer, {
    url: 'https://static.crates.io/crates/selectors/selectors-0.36.1.crate',
    sha256: 'c5d9c0c92a92d33f08817311cf3f2c29a3538a8240e94a6a3c622ce652d7e00c',
    instructions: 'Corresponding source for the unmodified selectors 0.36.1 crate is available at https://static.crates.io/crates/selectors/selectors-0.36.1.crate. Verify the downloaded archive with SHA-256 c5d9c0c92a92d33f08817311cf3f2c29a3538a8240e94a6a3c622ce652d7e00c.',
  });
  const manifest = structuredClone(checkedIn);
  await f.write('scripts/license-fallbacks/manifest.json', manifest);
  const packages = [], nodes = [];
  for (const entry of manifest.packages) {
    const directory = entry.sourceOffer ? `registry/src/fixture-index/${entry.name}-${entry.version}` :
      `upstream/${entry.name}`;
    if (entry.sourceOffer) {
      const archive = `Fixture source archive for ${entry.name}@${entry.version}`;
      const fixtureHash = createHash('sha256').update(archive).digest('hex');
      entry.sourceOffer.instructions = entry.sourceOffer.instructions.replaceAll(entry.sourceOffer.sha256, fixtureHash);
      entry.sourceOffer.sha256 = fixtureHash;
      await f.write(`registry/cache/fixture-index/${entry.name}-${entry.version}.crate`, archive);
    }
    await f.write(`${directory}/.cargo_vcs_info.json`, { git: { sha1: entry.revision }, ...(entry.pathInVcs === null ? {} : { path_in_vcs: entry.pathInVcs }) });
    for (const link of entry.linkedTerms || []) {
      await f.write(`${directory}/${link.packageFile}`, manifest.sources[link.declaration].text);
    }
    if (entry.supplement) {
      const sdk = JSON.parse(await fs.readFile(path.join(__dirname, 'license-fallbacks', entry.supplement)));
      for (const file of sdk.matchedFiles) {
        const bytes = `Fixture bytes for ${file.crateFile}`;
        await f.write(`${directory}/${file.crateFile}`, bytes);
        file.bytes = Buffer.byteLength(bytes);
        file.sha256 = createHash('sha256').update(bytes).digest('hex');
      }
      await f.write(`scripts/license-fallbacks/${entry.supplement}`, sdk);
    }
    packages.push({ id: entry.name, name: entry.name, version: entry.version, license: entry.license,
      ...(entry.sourceOffer ? { checksum: entry.sourceOffer.sha256 } : {}),
      repository: entry.repository, source: 'registry+https://github.com/rust-lang/crates.io-index', manifest_path: path.join(f.root, directory, 'Cargo.toml') });
    nodes.push({ id: entry.name, deps: [] });
  }
  await f.write('scripts/license-fallbacks/manifest.json', manifest);
  const metadata = () => ({ version: 1, workspace_members: ['app'],
    packages: [{ id: 'app', name: 'repodeck-desktop' }, ...packages],
    resolve: { nodes: [{ id: 'app', deps: packages.map(pkg => ({ pkg: pkg.id, dep_kinds: [{ kind: null }] })) }, ...nodes] } });
  const doc = JSON.parse(await generateNotices({ root: f.root, metadata, inventory: true }));
  assert.equal(doc.collectionComplete, false);
  const objcBlockers = ['block2', 'dispatch2', 'objc2', 'objc2-app-kit', 'objc2-core-foundation',
    'objc2-core-graphics', 'objc2-encode', 'objc2-exception-helper', 'objc2-foundation',
    'objc2-io-surface', 'objc2-web-kit'];
  assert.deepEqual(doc.unresolved.map(pkg => pkg.name).sort(), objcBlockers.sort());
  const selectors = doc.packages.find(pkg => pkg.name === 'selectors');
  assert.deepEqual(selectors.sourceOffer, manifest.packages.find(entry => entry.name === 'selectors').sourceOffer);
  assert.ok(!selectors.unresolved);
  assert.ok(!doc.packages.find(pkg => pkg.name === 'webview2-com-sys').unresolved);
  for (const name of objcBlockers) {
    const pkg = doc.packages.find(candidate => candidate.name === name);
    const files = pkg.texts.filter(text => text.provenance.kind === 'pinned-upstream' &&
      text.provenance.applicability).map(text => text.file).sort();
    assert.deepEqual(files, pkg.license === 'MIT' ? ['LICENSE-MIT.txt'] :
      ['LICENSE-APACHE.txt', 'LICENSE-MIT.txt', 'LICENSE-ZLIB.txt']);
    assert.match(pkg.unresolved, /Issue #23 concerns prospective relicensing only/i);
    assert.match(pkg.unresolved, /not a prerequisite for the current declared licenses/i);
    assert.match(pkg.unresolved, /exact SDK inputs/i);
    assert.match(pkg.unresolved, /final application bundle/i);
    assert.doesNotMatch(pkg.unresolved, /permissions outstanding|prohibited|legal\/maintainer/i);
  }
  const actualSources = new Set(doc.packages.flatMap(pkg => pkg.texts).filter(text => text.provenance.kind === 'pinned-upstream').map(text => `${text.provenance.url}:${text.sha256}`));
  assert.equal(actualSources.size, manifest.sources.length);
});

test('fallback URL newlines and UTF-8 BOM are preserved; private paths remain rejected', async t => {
  const f = await fallbackFixture(t);
  f.source.text = '\ufeffSee https://www.apache.org/licenses/\n\nFixture terms\r\n';
  f.source.sha256 = createHash('sha256').update(f.source.text).digest('hex');
  await f.saveFallback();
  const doc = JSON.parse(await f.run());
  assert.ok(doc.packages.some(pkg => pkg.texts.some(text => text.text === f.source.text && text.sha256 === f.source.sha256)));
  f.source.text = 'C:/Users/fixture/private';
  f.source.sha256 = createHash('sha256').update(f.source.text).digest('hex');
  await f.saveFallback();
  await assert.rejects(f.run(), /private path/);
});

async function linkedTermsFixture(t) {
  const f = await fallbackFixture(t);
  const url = 'https://license.example.test/terms/2.0/';
  const declaration = { ...f.source, file: 'crate/lib.rs', role: 'evidence', text: `Fixture source explicitly refers to ${url}\n` };
  declaration.sha256 = createHash('sha256').update(declaration.text).digest('hex');
  f.source.repository = 'https://github.com/fixture/license-steward';
  f.source.revision = 'c'.repeat(40);
  f.manifest.sources.push(declaration);
  f.entry.sources.push(1);
  f.entry.status = 'blocked';
  f.entry.reason = 'Actual license text available; distribution/source delivery decision pending.';
  f.entry.linkedTerms = [{ source: 0, declaration: 1, packageFile: 'lib.rs', url, textUrl: 'https://license.example.test/terms/2.0/index.txt' }];
  await f.write('crate/lib.rs', declaration.text);
  await f.saveFallback();
  return f;
}

test('explicit pinned source reference makes external terms available without clearing distribution review', async t => {
  const f = await linkedTermsFixture(t);
  const doc = JSON.parse(await f.run({ inventory: true }));
  const pkg = doc.packages.find(pkg => pkg.name === f.entry.name);
  assert.equal(pkg.licenseTextAvailable, true);
  assert.equal(doc.collectionComplete, false);
  assert.match(pkg.unresolved, /delivery decision/);
  const text = pkg.texts.find(text => text.provenance.repository === f.source.repository);
  assert.equal(text.sha256, f.source.sha256);
  assert.equal(text.provenance.applicability.url, f.entry.linkedTerms[0].url);
  assert.equal(text.provenance.applicability.declarationSha256, f.manifest.sources[1].sha256);
  await assert.rejects(f.run(), /unresolved/i);
});

test('external terms require a bound same-package declaration and an explicit URL', async t => {
  const f = await linkedTermsFixture(t);
  const link = f.entry.linkedTerms[0];
  for (const [field, value] of [['source', 99], ['declaration', 0], ['packageFile', '../lib.rs'],
    ['packageFile', 'other.rs'], ['url', 'https://unmentioned.example.test/'],
    ['url', 'https://license.example.test/'], ['textUrl', 'file:///private/terms']]) {
    const previous = link[field];
    link[field] = value;
    await f.saveFallback();
    await assert.rejects(f.run({ inventory: true }), /linked terms|fallback/i);
    link[field] = previous;
  }
  f.entry.linkedTerms = [];
  await f.saveFallback();
  await assert.rejects(f.run({ inventory: true }), /does not match package provenance/);
});

test('changed or linked installed declaration cannot justify external license text', async t => {
  const f = await linkedTermsFixture(t);
  await f.write('crate/lib.rs', 'Fixture source no longer contains the declaration');
  await assert.rejects(f.run({ inventory: true }), /declaration.*hash/i);
  await fs.rm(path.join(f.root, 'crate/lib.rs'));
  await fs.mkdir(path.join(f.root, 'crate/lib.rs'));
  await assert.rejects(f.run({ inventory: true }), /declaration.*regular/i);
});

test('repository-root declaration can bind external terms only when identical bytes ship in the crate', async t => {
  const f = await linkedTermsFixture(t);
  const declaration = f.manifest.sources[1];
  declaration.file = 'LICENSE.md';
  f.entry.linkedTerms[0].packageFile = 'LICENSE.md';
  await f.write('crate/LICENSE.md', declaration.text);
  await f.saveFallback();
  const doc = JSON.parse(await f.run({ inventory: true }));
  assert.equal(doc.packages.find(pkg => pkg.name === f.entry.name).licenseTextAvailable, true);
  await f.write('crate/LICENSE.md', `${declaration.text}changed`);
  await assert.rejects(f.run({ inventory: true }), /declaration.*hash/i);
});

test('pinned repository-root declaration can bind terms when the published crate omits that file', async t => {
  const f = await linkedTermsFixture(t);
  const declaration = f.manifest.sources[1];
  declaration.file = 'LICENSE.md';
  f.entry.linkedTerms[0].packageFile = null;
  await fs.rm(path.join(f.root, 'crate/lib.rs'));
  await f.saveFallback();
  const doc = JSON.parse(await f.run({ inventory: true }));
  const text = doc.packages.find(pkg => pkg.name === f.entry.name).texts.find(item =>
    item.provenance.applicability);
  assert.equal(text.provenance.applicability.packageFile, null);
  declaration.file = 'other/LICENSE.md';
  await f.saveFallback();
  await assert.rejects(f.run({ inventory: true }), /linked terms package path/i);
});

test('source offer is retained only for the exact Cargo registry archive and checksum', async t => {
  const f = await fallbackFixture(t);
  const checksum = 'f5efc7811552759e125c7c2dab6b9ac965d2457f04a1d3402ae926b4d1bcff32';
  const url = 'https://static.crates.io/crates/windows-crate/windows-crate-2.0.0.crate';
  const instructions = `Corresponding source for the unmodified windows-crate 2.0.0 package is available at ${url}. Verify the downloaded archive with SHA-256 ${checksum}.`;
  f.entry.sourceOffer = { url, sha256: checksum, instructions };
  f.entry.status = 'text-reviewed';
  const packageDirectory = path.join(f.root, 'registry/src/fixture-index/windows-crate-2.0.0');
  await fs.mkdir(path.dirname(packageDirectory), { recursive: true });
  await fs.cp(path.join(f.root, 'crate'), packageDirectory, { recursive: true });
  await f.write('registry/cache/fixture-index/windows-crate-2.0.0.crate', 'fixture source archive');
  const metadata = target => {
    const value = f.metadata(target);
    value.packages[1].manifest_path = path.join(packageDirectory, 'Cargo.toml');
    return value;
  };
  await f.saveFallback();
  const doc = JSON.parse(await generateNotices({ root: f.root, metadata }));
  assert.equal(doc.collectionComplete, true);
  assert.deepEqual(doc.packages.find(pkg => pkg.name === f.entry.name).sourceOffer,
    { url, sha256: checksum, instructions });

  for (const [field, value] of [['sha256', 'e'.repeat(64)],
    ['url', 'https://static.crates.io/crates/windows-crate/other-2.0.0.crate'],
    ['url', 'https://user@example.test/windows-crate-2.0.0.crate'],
    ['url', `${url}#fragment`], ['instructions', ''], ['instructions', 'x'.repeat(4097)]]) {
    const previous = f.entry.sourceOffer[field];
    f.entry.sourceOffer[field] = value;
    await f.saveFallback();
    await assert.rejects(generateNotices({ root: f.root, metadata }), /source offer/i);
    f.entry.sourceOffer[field] = previous;
  }
  await f.saveFallback();
  await f.write('registry/cache/fixture-index/windows-crate-2.0.0.crate', 'changed source archive');
  await assert.rejects(generateNotices({ root: f.root, metadata }), /source offer.*hash/i);
});

test('SDK supplemental texts require matching crate binaries and remain blocked for distribution', async t => {
  const f = await fallbackFixture(t);
  const sdk = JSON.parse(await fs.readFile(path.join(__dirname, 'license-fallbacks/webview2-sdk.json')));
  assert.equal(sdk.matchedFiles.length, 9);
  for (const text of sdk.texts) assert.equal(createHash('sha256').update(text.text).digest('hex'), text.sha256);
  sdk.crate = { name: f.entry.name, version: f.entry.version, repository: f.entry.repository, revision: f.entry.revision, pathInVcs: f.entry.pathInVcs };
  sdk.sdk.updateSource = `${f.entry.repository}/blob/${f.entry.revision}/update.rs`;
  for (const file of sdk.matchedFiles) {
    const bytes = `Fixture ${file.crateFile}`;
    await f.write(`crate/${file.crateFile}`, bytes);
    file.bytes = Buffer.byteLength(bytes);
    file.sha256 = createHash('sha256').update(bytes).digest('hex');
  }
  f.entry.supplement = 'sdk.json';
  f.entry.status = 'blocked';
  await f.saveFallback();
  const saveSdk = () => f.write('scripts/license-fallbacks/sdk.json', sdk);
  await saveSdk();
  const doc = JSON.parse(await f.run({ inventory: true }));
  const texts = doc.packages.find(pkg => pkg.name === f.entry.name).texts.filter(text => text.provenance.kind === 'pinned-archive');
  assert.equal(texts.length, 3);
  assert.equal(texts[0].provenance.archiveSha256, sdk.archiveSha256);
  assert.equal(texts[0].provenance.matchedFiles.length, 9);
  assert.equal(doc.collectionComplete, false);
  await assert.rejects(f.run(), /unresolved/i);
  for (const [object, key, value] of [[sdk.crate, 'version', '99.0.0'],
    [sdk.matchedFiles[0], 'bytes', 16 * 1024 * 1024 + 1],
    [sdk, 'matchedFiles', sdk.matchedFiles.slice(1)], [sdk, 'status', 'approved']]) {
    const previous = object[key];
    object[key] = value;
    await saveSdk();
    await assert.rejects(f.run({ inventory: true }), /SDK/i);
    object[key] = previous;
  }
  await saveSdk();
  await f.write(`crate/${sdk.matchedFiles[0].crateFile}`, 'x'.repeat(sdk.matchedFiles[0].bytes));
  await assert.rejects(f.run({ inventory: true }), /SDK.*hash/i);
  await f.write(`crate/${sdk.matchedFiles[0].crateFile}`, 'x'.repeat(sdk.matchedFiles[0].bytes + 1));
  await assert.rejects(f.run({ inventory: true }), /SDK.*size/i);
  const archiveUrl = sdk.archiveUrl;
  sdk.archiveUrl = 'https://unrelated.example.test/sdk.nupkg';
  await saveSdk();
  await assert.rejects(f.run({ inventory: true }), /SDK archive/i);
  sdk.archiveUrl = archiveUrl;
  const crateFile = sdk.matchedFiles[0].crateFile;
  sdk.matchedFiles[0].crateFile = '../outside.dll';
  await saveSdk();
  await assert.rejects(f.run({ inventory: true }), /SDK binary path/i);
  sdk.matchedFiles[0].crateFile = crateFile;
  sdk.texts[0].text += 'tampered';
  await saveSdk();
  await assert.rejects(f.run({ inventory: true }), /SDK text hash/i);
});
