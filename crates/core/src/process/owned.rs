use std::{io, process::Command, process::ExitStatus};

#[cfg(unix)]
#[path = "owned/unix.rs"]
mod platform;
#[cfg(windows)]
#[path = "owned/windows.rs"]
mod platform;

pub(super) struct OwnedChild(platform::OwnedChild);

impl OwnedChild {
    pub(super) fn spawn(command: &mut Command) -> io::Result<Self> {
        platform::OwnedChild::spawn(command).map(Self)
    }

    pub(super) fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        self.0.try_wait()
    }

    pub(super) fn terminate(&mut self) -> io::Result<()> {
        self.0.terminate()
    }
}
