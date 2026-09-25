use std::time::{Duration, Instant};
use std::{io, process::Command, process::ExitStatus};

const CLEANUP_TIMEOUT: Duration = Duration::from_secs(2);

fn poll_until<T>(
    deadline: Instant,
    mut poll: impl FnMut() -> io::Result<Option<T>>,
) -> io::Result<T> {
    loop {
        if let Some(value) = poll()? {
            return Ok(value);
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "owned process cleanup timed out",
            ));
        }
        std::thread::sleep(remaining.min(Duration::from_millis(10)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_cleanup_is_bounded_and_does_not_restart_expired_deadlines() {
        let start = Instant::now();
        let deadline = start + Duration::from_millis(30);
        assert_eq!(
            poll_until::<()>(deadline, || Ok(None)).unwrap_err().kind(),
            io::ErrorKind::TimedOut
        );
        let expired = Instant::now();
        assert_eq!(
            poll_until::<()>(deadline, || Ok(None)).unwrap_err().kind(),
            io::ErrorKind::TimedOut
        );
        assert!(expired.elapsed() < Duration::from_millis(100));
        assert!(start.elapsed() < Duration::from_secs(1));
    }
}

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
