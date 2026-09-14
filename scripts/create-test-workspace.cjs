const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');

function createFixture(destination, publicRoot) {
  const root = path.resolve(destination);
  // Never reset or reuse a folder: testers may have added valuable local changes.
  fs.mkdirSync(root, { recursive: false });
  const workspace = path.join(root, 'workspace');
  const support = path.join(root, 'support');
  fs.mkdirSync(workspace);
  fs.mkdirSync(support);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  Object.assign(env, {
    HOME: support, USERPROFILE: support, XDG_CONFIG_HOME: support,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(support, 'empty-config'),
    GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never',
    GIT_AUTHOR_NAME: 'RepoDeck Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'RepoDeck Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    GIT_AUTHOR_DATE: '2026-01-01T12:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T12:00:00Z',
  });
  fs.writeFileSync(env.GIT_CONFIG_GLOBAL, '');
  const hooks = path.join(support, 'empty-hooks');
  fs.mkdirSync(hooks);
  function git(cwd, args, expected = 0) {
    const result = spawnSync('git', ['-c', `core.hooksPath=${hooks}`, '-c', 'commit.gpgSign=false',
      '-c', 'core.autocrlf=false', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
      '-C', cwd, ...args], { env, encoding: 'utf8', timeout: 30000, windowsHide: true });
    if (result.error) throw result.error;
    assert.equal(result.status, expected, `git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout;
  }
  function write(base, relative, contents) {
    const file = path.join(base, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
  function init(relative, base = workspace, commit = true) {
    const directory = path.join(base, relative);
    fs.mkdirSync(directory, { recursive: true });
    git(directory, ['init', '--initial-branch=main', '--template=']);
    if (commit) {
      write(directory, 'README.md', `# ${relative}\n\nSynthetic RepoDeck test data.\n`);
      git(directory, ['add', '.']);
      git(directory, ['commit', '-m', 'Initial fixture']);
    }
    return directory;
  }
  const cases = [];
  function expect(relative, branch, status, note) {
    const directory = path.join(workspace, relative);
    assert.equal(git(directory, ['status', '--porcelain=v1', '-uall']), status, relative);
    const actualBranch = git(directory, ['symbolic-ref', '--short', '-q', 'HEAD'], branch === null ? 1 : 0).trim();
    assert.equal(actualBranch, branch || '', relative);
    cases.push({ path: relative, branch, status, note });
  }

  const frontend = init('01-flat/frontend');
  write(frontend, '.gitignore', 'node_modules/\ndist/\nlocal.secret\n');
  write(frontend, 'src/old-name.ts', 'export const name = "old";\n');
  write(frontend, 'src/remove-me.ts', 'export const obsolete = true;\n');
  git(frontend, ['add', '.']); git(frontend, ['commit', '-m', 'Tracked source']);
  git(frontend, ['mv', 'src/old-name.ts', 'src/new-name.ts']);
  fs.unlinkSync(path.join(frontend, 'src/remove-me.ts'));
  fs.appendFileSync(path.join(frontend, 'README.md'), '\nUnstaged edit.\n');
  write(frontend, 'new file.txt', 'Untracked file with spaces.\n');
  write(frontend, 'local.secret', 'FAKE_TEST_VALUE_ONLY\n');
  write(frontend, 'node_modules/demo/index.js', '// Excluded test data; never execute.\n');
  expect('01-flat/frontend', 'main', ' M README.md\nR  src/old-name.ts -> src/new-name.ts\n D src/remove-me.ts\n?? "new file.txt"\n', 'Modified, staged rename, deleted, untracked; ignored local.secret and node_modules.');
  init('01-flat/api');
  expect('01-flat/api', 'main', '', 'Clean sibling repository.');

  const worker = init('02-deep/business/payments/services/worker');
  write(worker, 'notes/next-task.md', 'Untracked task notes.\n');
  expect('02-deep/business/payments/services/worker', 'main', '?? notes/next-task.md\n', 'Repository five levels below the workspace.');

  const parent = init('03-nested/platform');
  write(parent, '.gitignore', 'plugins/independent/\n');
  git(parent, ['add', '.']); git(parent, ['commit', '-m', 'Ignore independently owned child']);
  init('03-nested/platform/plugins/independent');
  expect('03-nested/platform', 'main', '', 'Clean parent; child is ignored by parent Git but discoverable by RepoDeck.');
  expect('03-nested/platform/plugins/independent', 'main', '', 'Independent nested repository, not a submodule.');

  const mono = init('04-monorepo/product');
  write(mono, 'apps/web/index.txt', 'Web application\n');
  write(mono, 'apps/mobile/index.txt', 'Mobile application\n');
  write(mono, 'packages/shared/index.txt', 'Shared package\n');
  write(mono, '.agents/workflows/review.md', '# Fixture review workflow\n\nThis is inert sample configuration.\n');
  write(mono, '.claude/settings.json', '{"permissions":{"allow":[]}}\n');
  write(mono, 'AGENTS.md', '# Fixture instructions\n\nSample data only; do not execute repository tasks.\n');
  git(mono, ['add', '.']); git(mono, ['commit', '-m', 'Monorepo and agent files']);
  expect('04-monorepo/product', 'main', '', 'One repository containing multiple applications and agent settings.');

  const unborn = init('05-edge-cases/no-commits', workspace, false);
  write(unborn, 'README.md', 'No commit exists yet.\n');
  expect('05-edge-cases/no-commits', 'main', '?? README.md\n', 'Unborn branch; no history.');
  const conflict = init('05-edge-cases/merge-conflict');
  git(conflict, ['checkout', '-b', 'other']);
  write(conflict, 'README.md', 'Other branch content\n');
  git(conflict, ['commit', '-am', 'Other edit']);
  git(conflict, ['checkout', 'main']);
  write(conflict, 'README.md', 'Main branch content\n');
  git(conflict, ['commit', '-am', 'Main edit']);
  git(conflict, ['merge', '--no-edit', 'other'], 1);
  expect('05-edge-cases/merge-conflict', 'main', 'UU README.md\n', 'Intentional unresolved merge conflict.');

  const source = init('worktree-source', support);
  const linked = path.join(workspace, '06-worktrees/feature-checkout');
  git(source, ['worktree', 'add', '-b', 'feature/agent-task', linked]);
  expect('06-worktrees/feature-checkout', 'feature/agent-task', '', 'Linked worktree; metadata is in sibling support directory.');

  const library = init('submodule-source', support);
  const superproject = init('07-submodules/application');
  git(superproject, ['-c', 'protocol.file.allow=always', 'submodule', 'add', library.replaceAll('\\', '/'), 'vendor/library']);
  git(superproject, ['commit', '-am', 'Add local submodule']);
  const submodule = path.join(superproject, 'vendor/library');
  git(submodule, ['checkout', '--detach']);
  fs.appendFileSync(path.join(submodule, 'README.md'), '\nLocal submodule change.\n');
  expect('07-submodules/application', 'main', ' M vendor/library\n', 'Parent reports a modified submodule.');
  expect('07-submodules/application/vendor/library', null, ' M README.md\n', 'Detached submodule with a real text diff.');

  write(workspace, '08-not-a-repository/design/brief.md', '# Ordinary project notes\n');
  write(workspace, '08-not-a-repository/assets/sample.json', '{"sample":true}\n');
  write(workspace, '08-not-a-repository/.agents/plans/demo.md', '# Inert planning sample\n');
  write(workspace, '08-not-a-repository/.claude/settings.json', '{}\n');
  write(workspace, '08-not-a-repository/.hidden-note.txt', 'Visible with hidden files enabled.\n');
  write(workspace, '08-not-a-repository/assets/binary.dat', Buffer.from([0, 1, 2, 255]));
  fs.mkdirSync(path.join(workspace, '08-not-a-repository/empty-folder'));

  const publicProjects = [
    ['express', 'https://github.com/expressjs/express.git'],
    ['flask', 'https://github.com/pallets/flask.git'],
    ['gitlab-cli', 'https://gitlab.com/gitlab-org/cli.git'],
  ];
  if (publicRoot) for (const [name, url] of publicProjects) {
    const original = path.join(publicRoot, name);
    if (!fs.existsSync(path.join(original, '.git'))) continue;
    const relative = `09-public-projects/${name}`;
    const clone = path.join(workspace, relative);
    git(support, ['clone', '--no-hardlinks', '--', original, clone]);
    git(clone, ['remote', 'set-url', 'origin', url]);
    const branch = git(clone, ['symbolic-ref', '--short', 'HEAD']).trim();
    expect(relative, branch, '', 'Offline copy of an existing public checkout; no project scripts run.');
    cases.at(-1).commit = git(clone, ['rev-parse', 'HEAD']).trim();
    cases.at(-1).remote = url;
  }
  const manifest = { schemaVersion: 1, workspace, repositoryCount: cases.length, repositories: cases };
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  write(workspace, 'START-HERE.md', '# RepoDeck test workspace\n\nOpen this folder in RepoDeck. Expected repository states are in ../manifest.json.\nKeep the sibling support folder: it owns linked-worktree and submodule fixtures.\nAll synthetic files are disposable; public projects retain their own licenses.\n');
  return manifest;
}

if (require.main === module) {
  try {
    const parent = path.resolve('.tools/test-workspaces');
    fs.mkdirSync(parent, { recursive: true });
    const destination = process.argv[2] || path.join(parent, `manual-${Date.now()}`);
    const result = createFixture(destination, path.resolve('.tools/fixtures'));
    console.log(`Created and Git-verified ${result.repositoryCount} repositories.\nAdd this folder in RepoDeck:\n${result.workspace}\nManifest: ${path.join(path.dirname(result.workspace), 'manifest.json')}`);
  } catch (error) { console.error(error); process.exitCode = 1; }
}

module.exports = { createFixture };
