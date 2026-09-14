use std::{
    io::{Read, Seek, SeekFrom, Write},
    process::{Child, Command, Output, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

#[derive(Debug, PartialEq)]
pub enum ProcessError {
    Start,
    Io,
    Timeout,
    Cancelled,
    OutputLimit,
}

struct RunningChild(Child);
impl Drop for RunningChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

pub fn run(
    command: &mut Command,
    timeout: Duration,
    max_bytes: u64,
    cancelled: &AtomicBool,
) -> Result<Output, ProcessError> {
    run_input(command, timeout, max_bytes, cancelled, &[])
}

pub fn run_input(
    command: &mut Command,
    timeout: Duration,
    max_bytes: u64,
    cancelled: &AtomicBool,
    input: &[u8],
) -> Result<Output, ProcessError> {
    if cancelled.load(Ordering::Relaxed) {
        return Err(ProcessError::Cancelled);
    }
    let mut stdout = tempfile::tempfile().map_err(|_| ProcessError::Io)?;
    let mut stderr = tempfile::tempfile().map_err(|_| ProcessError::Io)?;
    let mut stdin = tempfile::tempfile().map_err(|_| ProcessError::Io)?;
    stdin.write_all(input).map_err(|_| ProcessError::Io)?;
    stdin
        .seek(SeekFrom::Start(0))
        .map_err(|_| ProcessError::Io)?;
    command
        .stdin(Stdio::from(stdin))
        .stdout(stdout.try_clone().map_err(|_| ProcessError::Io)?)
        .stderr(stderr.try_clone().map_err(|_| ProcessError::Io)?);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let start = Instant::now();
    let mut child = RunningChild(command.spawn().map_err(|_| ProcessError::Start)?);
    loop {
        if cancelled.load(Ordering::Relaxed) {
            return Err(ProcessError::Cancelled);
        }
        let bytes = stdout
            .metadata()
            .map_err(|_| ProcessError::Io)?
            .len()
            .saturating_add(stderr.metadata().map_err(|_| ProcessError::Io)?.len());
        if bytes > max_bytes {
            return Err(ProcessError::OutputLimit);
        }
        if start.elapsed() >= timeout {
            return Err(ProcessError::Timeout);
        }
        if let Some(status) = child.0.try_wait().map_err(|_| ProcessError::Io)? {
            stdout
                .seek(SeekFrom::Start(0))
                .map_err(|_| ProcessError::Io)?;
            stderr
                .seek(SeekFrom::Start(0))
                .map_err(|_| ProcessError::Io)?;
            let mut out = Vec::new();
            let mut err = Vec::new();
            stdout
                .take(max_bytes.saturating_add(1))
                .read_to_end(&mut out)
                .map_err(|_| ProcessError::Io)?;
            stderr
                .take(max_bytes.saturating_add(1))
                .read_to_end(&mut err)
                .map_err(|_| ProcessError::Io)?;
            if out.len().saturating_add(err.len()) as u64 > max_bytes {
                return Err(ProcessError::OutputLimit);
            }
            return Ok(Output {
                status,
                stdout: out,
                stderr: err,
            });
        }
        // Temporary files avoid pipe backpressure and blocked reader threads.
        // The polling limit bounds returned data, not instantaneous disk writes.
        std::thread::sleep(Duration::from_millis(10));
    }
}
