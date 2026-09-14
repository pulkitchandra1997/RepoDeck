import type { Repository } from './types';
export function repositoryStatus(repository: Repository): { label: string; tone: string } {
  const conflicts = repository.changes.filter(change => ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(change.index + change.worktree)).length;
  if (conflicts) return { label: `${conflicts} conflict${conflicts === 1 ? '' : 's'}`, tone: 'danger' };
  const changes = repository.changes.filter(change => change.index !== '!').length;
  if (changes) return { label: `${changes} change${changes === 1 ? '' : 's'}`, tone: 'amber' };
  if (repository.detached) return { label: 'Detached HEAD', tone: 'amber' };
  if (repository.ahead || repository.behind) return { label: `${repository.ahead} ahead / ${repository.behind} behind`, tone: 'amber' };
  return { label: 'Clean', tone: 'green' };
}
