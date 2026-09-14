import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, FolderGit2, FolderPlus } from 'lucide-react';

const steps = [
  { title: 'Choose a project folder', description: 'Use Add workspace to select a parent folder containing several repositories, or select one Git repository directly. RepoDeck opens local folders; clone remote repositories with Git first.', image: new URL('./assets/onboarding/add-workspace.png', import.meta.url).href, alt: 'RepoDeck with the Add workspace folder button highlighted beside the workspace list.' },
  { title: 'Review changes across repositories', description: 'Select a repository to see its branch and changed files. Open a changed file to review its diff. Refresh updates the view; it does not commit, push or change your code.', image: new URL('./assets/onboarding/review-changes.png', import.meta.url).href, alt: 'A sample workspace containing two repositories, with a modified checkout file and its text diff selected.' },
  { title: 'Keep project context in view', description: 'Files includes Git and ordinary folders. Agents collects instructions such as AGENTS.md, .agents and .claude settings. Preview them here or open them in your editor; RepoDeck does not run these instructions.', image: new URL('./assets/onboarding/agent-files.png', import.meta.url).href, alt: 'The Agents tab showing a sample AGENTS.md file and its readable preview.' },
];

export default function Onboarding({ firstRun, onFinish }: { firstRun: boolean; onFinish: (addWorkspace: boolean) => Promise<void> }) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const pending = useRef(false);
  useEffect(() => { heading.current?.focus(); }, [step]);
  async function finish(add: boolean) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await onFinish(add); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { pending.current = false; setBusy(false); }
  }
  const current = steps[step];
  return <main className="onboarding" aria-label="RepoDeck tour" aria-busy={busy}>
    <div className="tour-shell">
      <header className="tour-header">
        <div className="tour-brand"><FolderGit2 size={24} aria-hidden="true" /><strong>RepoDeck</strong></div>
        <button disabled={busy} onClick={() => void finish(false)}>{firstRun ? 'Skip tour' : 'Close tour'}</button>
      </header>
      <section aria-labelledby="tour-heading" className="tour-content">
        <p className="tour-progress" aria-live="polite">{step + 1} of {steps.length}</p>
        <h1 id="tour-heading" ref={heading} tabIndex={-1}>{current.title}</h1>
        <p className="tour-description">{current.description}</p>
        <img className="tour-image" src={current.image} alt={current.alt} width={1100} height={660} />
      </section>
      {error && <p className="danger" role="alert">{error}</p>}
      <footer className="tour-footer">
        <button disabled={busy || step === 0} onClick={() => setStep(step - 1)}><ArrowLeft size={16} aria-hidden="true" />Back</button>
        {step < steps.length - 1 ? <button className="primary" disabled={busy} onClick={() => setStep(step + 1)}>Next<ArrowRight size={16} aria-hidden="true" /></button>
          : <button className="primary" disabled={busy} onClick={() => void finish(firstRun)}>{firstRun ? <FolderPlus size={16} aria-hidden="true" /> : null}{firstRun ? 'Add a workspace' : 'Done'}</button>}
      </footer>
    </div>
  </main>;
}
