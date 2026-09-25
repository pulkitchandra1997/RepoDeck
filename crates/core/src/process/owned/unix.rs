use super::{poll_until, CLEANUP_TIMEOUT};
use std::{
    io,
    os::unix::process::CommandExt,
    process::{Child, Command, ExitStatus},
    time::Instant,
};

#[path = "unix/reaper.rs"]
mod reaper;

pub(super) struct OwnedChild {
    child: Option<Child>,
    slot: Option<reaper::Slot>,
    // Present only while our exclusively waited, unreaped child pins this identity.
    pgid: Option<i32>,
    parent_status: Option<ExitStatus>,
    cleanup_deadline: Option<Instant>,
}

impl OwnedChild {
    pub(super) fn spawn(command: &mut Command) -> io::Result<Self> {
        let slot = reaper::Slot::reserve()?;
        command.process_group(0);
        let child = command.spawn()?;
        let pgid = child.id() as i32; // Unix pid_t is signed; spawn returns a positive PID.
        Ok(Self {
            child: Some(child),
            slot: Some(slot),
            pgid: Some(pgid),
            parent_status: None,
            cleanup_deadline: None,
        })
    }

    // WNOWAIT retains the zombie/PID. Child::try_wait must not precede the final signal.
    fn parent_exited(&mut self) -> io::Result<bool> {
        let Some(pgid) = self.pgid else {
            return Err(io::Error::from_raw_os_error(libc::ECHILD));
        };
        let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
        if unsafe {
            libc::waitid(
                libc::P_PID,
                pgid as libc::id_t,
                &mut info,
                libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
            )
        } != 0
        {
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::ECHILD) {
                self.pgid = None;
            }
            return Err(error);
        }
        Ok(unsafe { info.si_pid() } == pgid)
    }

    pub(super) fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        if self.parent_status.is_some() {
            return Ok(self.parent_status);
        }
        if self.parent_exited()? {
            // Parent completion ends this command's scope, including remaining descendants.
            self.terminate()?;
        }
        Ok(self.parent_status)
    }

    pub(super) fn terminate(&mut self) -> io::Result<()> {
        if self.parent_status.is_some() {
            return Ok(());
        }
        let deadline = *self
            .cleanup_deadline
            .get_or_insert_with(|| Instant::now() + CLEANUP_TIMEOUT);
        if self.pgid.is_some() {
            self.parent_exited()?; // ECHILD revokes signal authority without touching a recycled PID.
            let pgid = self.pgid.take().expect("verified unreaped child");
            let result = unsafe { libc::kill(-pgid, libc::SIGKILL) };
            let error = (result != 0).then(io::Error::last_os_error);
            // This is the final numeric signal, still before any reaping operation.
            let _ = self.child.as_mut().unwrap().kill();
            #[cfg(target_os = "macos")]
            {
                // Darwin reports EPERM for zombie-only groups. Confirm there are no live
                // members while the unreaped leader still pins the group number.
                poll_until(deadline, || {
                    Ok((!live_group_members(pgid, deadline)?).then_some(()))
                })?;
                let _ = error;
            }
            #[cfg(not(target_os = "macos"))]
            if let Some(error) = error {
                if error.raw_os_error() != Some(libc::ESRCH) {
                    return Err(error);
                }
            }
        }
        self.parent_status = Some(poll_until(deadline, || {
            self.child.as_mut().unwrap().try_wait()
        })?);
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn live_group_members(pgid: i32, deadline: Instant) -> io::Result<bool> {
    // A full buffer is incomplete evidence; fail closed rather than infer an empty group.
    let mut pids = [0i32; 4096];
    unsafe {
        *libc::__error() = 0;
    }
    let count = unsafe {
        libc::proc_listpgrppids(
            pgid,
            pids.as_mut_ptr().cast(),
            std::mem::size_of_val(&pids) as i32,
        )
    };
    if count < 0
        || count as usize >= pids.len()
        || (count == 0 && io::Error::last_os_error().raw_os_error() != Some(0))
    {
        return Err(io::Error::other("cannot enumerate owned process group"));
    }
    for pid in pids.into_iter().take(count as usize) {
        if Instant::now() >= deadline {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "owned group inspection timed out",
            ));
        }
        let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
        let size = std::mem::size_of_val(&info) as i32;
        let read = unsafe {
            libc::proc_pidinfo(
                pid,
                libc::PROC_PIDTBSDINFO,
                0,
                (&mut info as *mut libc::proc_bsdinfo).cast(),
                size,
            )
        };
        if read == 0 && io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH) {
            continue;
        }
        if read != size {
            return Err(io::Error::other("cannot inspect owned process group"));
        }
        if info.pbi_pgid == pgid as u32 && info.pbi_status != libc::SZOMB {
            return Ok(true);
        }
    }
    Ok(false)
}

impl Drop for OwnedChild {
    fn drop(&mut self) {
        let _ = self.terminate();
        if self.parent_status.is_none() {
            // Only nonblocking reaping remains. The reaper never signals a PID or group.
            self.slot.take().unwrap().defer(self.child.take().unwrap());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn exited_child() -> OwnedChild {
        let mut child = OwnedChild::spawn(Command::new("/bin/sh").args(["-c", "exit 17"])).unwrap();
        poll_until(Instant::now() + Duration::from_secs(2), || {
            Ok(child.parent_exited()?.then_some(()))
        })
        .unwrap();
        child
    }

    #[test]
    fn exit_observation_retains_identity_until_final_signal_then_reaps() {
        let mut child = exited_child();
        let pgid = child.pgid.unwrap();
        for _ in 0..3 {
            assert!(child.parent_exited().unwrap());
        }
        child.terminate().unwrap();
        assert_eq!(child.parent_status.unwrap().code(), Some(17));
        assert!(child.pgid.is_none());
        let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
        assert_eq!(
            unsafe {
                libc::waitid(
                    libc::P_PID,
                    pgid as libc::id_t,
                    &mut info,
                    libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
                )
            },
            -1
        );
        assert_eq!(
            io::Error::last_os_error().raw_os_error(),
            Some(libc::ECHILD)
        );
        child.terminate().unwrap();
    }

    #[test]
    fn externally_reaped_child_revokes_signal_authority() {
        let mut child = exited_child();
        let pgid = child.pgid.unwrap();
        assert_eq!(
            unsafe { libc::waitpid(pgid, std::ptr::null_mut(), libc::WNOHANG) },
            pgid
        );
        assert_eq!(
            child.terminate().unwrap_err().raw_os_error(),
            Some(libc::ECHILD)
        );
        assert!(child.pgid.is_none());
        // Drop may only attempt nonblocking reaping now, never signal the old number.
        drop(child);
    }

    #[test]
    fn expired_cleanup_and_drop_defer_reaping_without_restarting_budget() {
        let mut child = OwnedChild::spawn(Command::new("/bin/sleep").arg("1")).unwrap();
        let pid = child.child.as_ref().unwrap().id();
        // Simulate a final signal already attempted while the OS still reports a live child.
        child.pgid = None;
        child.cleanup_deadline = Some(Instant::now());
        let start = Instant::now();
        assert_eq!(
            child.terminate().unwrap_err().kind(),
            io::ErrorKind::TimedOut
        );
        drop(child);
        assert!(start.elapsed() < Duration::from_millis(200));
        poll_until(Instant::now() + Duration::from_secs(3), || {
            let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
            let result = unsafe {
                libc::waitid(
                    libc::P_PID,
                    pid as libc::id_t,
                    &mut info,
                    libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
                )
            };
            Ok(
                (result == -1 && io::Error::last_os_error().raw_os_error() == Some(libc::ECHILD))
                    .then_some(()),
            )
        })
        .unwrap();
    }
}
