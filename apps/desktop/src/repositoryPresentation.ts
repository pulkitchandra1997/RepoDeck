import type { Change, Entry, Snapshot } from './types';

export function aliasKey(root: string, relative: string) {
  const normalized = root.replace(/^\\\\\?\\UNC\\/i, '//').replace(/^\\\\\?\\/, '').replaceAll('\\', '/').replace(/\/$/, '');
  const path = normalized + (relative === '.' ? '' : `/${relative}`);
  return /^[A-Za-z]:\//.test(path) || path.startsWith('//') ? path.toLowerCase() : path;
}
export function repositoryName(repo: Snapshot['repositories'][number], fallback: string) {
  const remote = repo.status?.originUrl;
  if (remote) {
    const name = remote.split(/[?#]/)[0].replace(/\/+$/, '').split(/[/:\\]/).at(-1)?.replace(/\.git$/, '');
    if (name) return name;
  }
  return repo.relativePath === '.' ? fallback : repo.relativePath.split('/').at(-1)!;
}
function owner(path: string, roots: Set<string>) {
  let current = path;
  while (current) {
    if (roots.has(current)) return current;
    current = current.slice(0, Math.max(0, current.lastIndexOf('/')));
  }
  return roots.has('.') ? '.' : undefined;
}
const extensions: Record<string, string> = { java: 'Java', kt: 'Kotlin', py: 'Python', ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', go: 'Go', rs: 'Rust', cs: 'C#', fs: 'F#', rb: 'Ruby', php: 'PHP', swift: 'Swift', c: 'C', cpp: 'C++', cc: 'C++', dart: 'Dart' };
const manifests: Record<string, string> = { 'pom.xml': 'Java', 'pyproject.toml': 'Python', 'setup.py': 'Python', 'requirements.txt': 'Python', 'Pipfile': 'Python', 'tsconfig.json': 'TypeScript', 'go.mod': 'Go', 'Cargo.toml': 'Rust', 'Gemfile': 'Ruby', 'composer.json': 'PHP', 'Package.swift': 'Swift', 'pubspec.yaml': 'Dart' };
export function projectTypes(entries: Entry[]) {
  const projectExtensions: Record<string, string> = { csproj: 'C#', fsproj: 'F#', vcxproj: 'C++' };
  const roots = new Set(entries.filter(e => e.repository).map(e => e.path));
  const data = new Map([...roots].map(root => [root, { manifests: new Set<string>(), sources: new Map<string, number>(), node: false }]));
  for (const entry of entries) {
    if (entry.directory || entry.path.split('/').some(part => ['node_modules', 'vendor', '.venv', 'venv', 'target', 'dist', 'build', '.git'].includes(part))) continue;
    const root = owner(entry.path, roots);
    if (root === undefined) continue;
    const record = data.get(root)!;
    const name = entry.path.split('/').at(-1)!;
    const extension = name.includes('.') ? name.split('.').at(-1)! : '';
    const manifest = Object.hasOwn(manifests, name) ? manifests[name] : Object.hasOwn(projectExtensions, extension) ? projectExtensions[extension] : undefined;
    if (manifest) record.manifests.add(manifest);
    if (name === 'package.json') record.node = true;
    if (Object.hasOwn(extensions, extension)) record.sources.set(extensions[extension], (record.sources.get(extensions[extension]) ?? 0) + 1);
  }
  return new Map([...data].map(([root, record]) => {
    if (record.node && !record.manifests.has('TypeScript')) record.manifests.add(record.sources.has('TypeScript') ? 'TypeScript' : 'JavaScript');
    if (!record.manifests.size && record.sources.size) {
      const ranked = [...record.sources].sort((a, b) => b[1] - a[1]);
      if (ranked.length === 1 || ranked[0][1] > ranked[1][1]) record.manifests.add(ranked[0][0]);
    }
    return [root, [...record.manifests].sort()];
  }));
}
export function changeStyle(change: Change) {
  const code = change.index + change.worktree;
  if (['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(code) || code.includes('U')) return { tone: 'danger', label: 'Conflict', rank: 4 };
  if (code.includes('!')) return { tone: '', label: 'Ignored', rank: 0 };
  if (code.includes('?')) return { tone: 'green', label: 'Untracked', rank: 1 };
  const state = code.includes('D') ? 'Deleted' : code.includes('R') ? 'Renamed' : code.includes('M') || code.includes('T') ? 'Modified' : code.includes('A') || code.includes('C') ? 'Added' : '';
  const stages = [change.index !== ' ' ? 'Staged' : '', change.worktree !== ' ' ? 'Unstaged' : ''].filter(Boolean).join(' + ');
  return { tone: state === 'Deleted' ? 'danger' : state === 'Added' ? 'green' : state ? 'amber' : '', label: [state, stages].filter(Boolean).join(' · '), rank: state === 'Deleted' ? 3 : state === 'Added' ? 1 : 2 };
}
export function fileStatuses(repositories: Snapshot['repositories']) {
  const roots = new Set(repositories.map(r => r.relativePath));
  const result = new Map<string, ReturnType<typeof changeStyle>>();
  for (const repo of repositories) {
    if (repo.error || !repo.status) continue;
    for (const change of repo.status.changes) {
      const path = (repo.relativePath === '.' ? '' : `${repo.relativePath}/`) + change.path.replace(/\/$/, '');
      if (owner(path, roots) !== repo.relativePath) continue;
      const state = changeStyle(change);
      result.set(path, state);
      let directory = path;
      while (directory.includes('/')) {
        directory = directory.slice(0, directory.lastIndexOf('/'));
        if (directory === repo.relativePath) break;
        if (owner(directory, roots) !== repo.relativePath) break;
        if (!result.has(directory) || result.get(directory)!.rank < state.rank) result.set(directory, { ...state, label: `Contains ${state.label.toLowerCase()}` });
      }
    }
  }
  return result;
}
export function diffTone(line: string, diff: boolean, hunkBody = false) {
  const text = diff && /^[ +\-]/.test(line) ? line.slice(1) : line;
  if (/^(<{7}|={7}|>{7}|\|{7})(\s|$)/.test(text)) return 'danger conflict-line';
  if (!diff || (!hunkBody && /^(---|\+\+\+|diff |index |@@)/.test(line))) return '';
  return line.startsWith('+') ? 'green' : line.startsWith('-') ? 'danger' : '';
}
