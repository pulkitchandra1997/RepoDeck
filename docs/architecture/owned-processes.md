# Owned subprocess lifetime

Issue #34 uses platform ownership in `crates/core/src/process/owned`.
Cancellation, timeout, output overflow, and normal direct-child exit end the
command scope and terminate descendants still in that scope. Normal completion
preserves the direct child's exit status. This runner is for bounded inspection
commands, not launching background applications.

## Identity and cleanup

- Windows starts the child suspended, assigns an anonymous kill-on-close Job
  Object, then resumes its initial thread. The guard exists before assignment or
  resumption can fail. Cleanup targets the job and exact process handle.
- Unix creates a new process group and observes its leader with
  `waitid(P_PID, WEXITED | WNOHANG | WNOWAIT)`. The unreaped child pins its PID
  through the final group and direct-child signals. Signal authority is consumed
  before reaping; neither cleanup retries nor the reaper signal an old number.
  `ECHILD` revokes authority immediately. RepoDeck must remain the exclusive
  waiter for these children; a global SIGCHLD reaper/auto-reap policy is incompatible.
- macOS checks up to 4096 members of the pinned group using libproc, treating a
  full buffer or unreadable result as incomplete. Only exited/zombie members
  permit successful cleanup. This also handles Darwin's zombie-only group EPERM.
- Cleanup starts one two-second deadline before termination and uses nonblocking
  polls. Spawn failures and Drop use the same guard; retries never reset the
  deadline. There is no blocking Child::wait in the ownership implementation.
- Unix reserves one of 64 process slots before spawn. An unreaped child after a
  deadline/error transfers its slot to one bounded reaper queue. One worker polls
  only those Child objects without signaling. Slots remain occupied until reap;
  exhaustion rejects new process starts instead of accumulating workers/zombies.

## Limits and evidence

This is not an OS sandbox. Unix descendants that deliberately leave their process
group are outside group containment. Other Unix targets deliver the group signal
and reap the direct child, but do not have the macOS live-member verification.
OS calls and scheduling cannot provide a hard real-time deadline; the two-second
budget bounds application polling and waits. An OS-stalled process can outlive
that budget, which is reported as failure rather than successful termination.

Regression coverage includes actual descendant heartbeat fixtures, unrelated
process survival, parent-exits-first cleanup, non-reaping Unix observation,
lost-identity revocation, deadline reuse, deferred reap, admission exhaustion,
and Windows setup failures before/after job assignment. Native CI must exercise
both macOS architectures and Windows on the reviewed PR revision.

API references: [Windows Job Object termination](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-terminatejobobject),
[Apple libproc interfaces](https://github.com/apple-oss-distributions/xnu/blob/main/libsyscall/wrappers/libproc/libproc.h).
