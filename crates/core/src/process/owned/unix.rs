use std::{
    io,
    os::unix::process::CommandExt,
    process::{Child, Command, ExitStatus},
    time::{Duration, Instant},
};

const CLEANUP_TIMEOUT: Duration = Duration::from_secs(2);

pub(super) struct OwnedChild {
    child: Child,
    pgid: i32,
    parent_status: Option<ExitStatus>,
    finished: bool,
}

impl OwnedChild {
    pub(super) fn spawn(command: &mut Command) -> io::Result<Self> {
        command.process_group(0);
        let child = command.spawn()?;
        let pgid = i32::try_from(child.id())
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "child PID exceeds i32"))?;
        Ok(Self {
            child,
            pgid,
            parent_status: None,
            finished: false,
        })
    }

    pub(super) fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        if self.finished {
            return Ok(self.parent_status);
        }
        if self.parent_status.is_none() {
            self.parent_status = self.child.try_wait()?;
        }
        if self.parent_status.is_some() && !self.group_exists()? {
            self.finished = true;
            return Ok(self.parent_status);
        }
        Ok(None)
    }

    pub(super) fn terminate(&mut self) -> io::Result<()> {
        if self.finished {
            return Ok(());
        }
        let group_result = self.signal_group(libc::SIGKILL);
        // Also target the exact child handle in case it deliberately changed groups.
        let _ = self.child.kill();
        if self.parent_status.is_none() {
            match self.child.wait() {
                Ok(status) => self.parent_status = Some(status),
                Err(error) if error.kind() == io::ErrorKind::InvalidInput => {}
                Err(error) => return Err(error),
            }
        }
        if let Err(error) = group_result {
            if error.raw_os_error() != Some(libc::ESRCH) {
                return Err(error);
            }
        }
        let deadline = Instant::now() + CLEANUP_TIMEOUT;
        while self.group_exists()? {
            if Instant::now() >= deadline {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "owned process group did not terminate",
                ));
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        self.finished = true;
        Ok(())
    }

    fn signal_group(&self, signal: i32) -> io::Result<()> {
        if unsafe { libc::kill(-self.pgid, signal) } == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }

    fn group_exists(&self) -> io::Result<bool> {
        match self.signal_group(0) {
            Ok(()) => Ok(true),
            Err(error) if error.raw_os_error() == Some(libc::ESRCH) => Ok(false),
            Err(error) if error.raw_os_error() == Some(libc::EPERM) => Ok(true),
            Err(error) => Err(error),
        }
    }
}

impl Drop for OwnedChild {
    fn drop(&mut self) {
        let _ = self.terminate();
    }
}
