use repodeck_core::process::{run, ProcessError};
use std::{
    io::Write,
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

fn child(mode: &str) -> Command {
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .args(["--exact", "process_fixture", "--ignored", "--nocapture"])
        .env("REPODECK_PROCESS_FIXTURE", mode);
    command
}

#[test]
#[ignore = "Child-process fixture, invoked by the runner tests"]
fn process_fixture() {
    match std::env::var("REPODECK_PROCESS_FIXTURE").unwrap().as_str() {
        "sleep" => std::thread::sleep(Duration::from_secs(3)),
        "output" => {
            println!("stdout marker");
            eprintln!("stderr marker");
        }
        "flood" => {
            let _ = std::io::stdout().write_all(&vec![b'x'; 200_000]);
        }
        "stderr" => {
            let _ = std::io::stderr().write_all(&vec![b'x'; 200_000]);
        }
        "failure" => std::process::exit(17),
        _ => panic!("unknown fixture"),
    }
}

#[test]
fn collects_stdout_stderr_and_real_exit_status() {
    let output = run(
        &mut child("output"),
        Duration::from_secs(5),
        65536,
        &AtomicBool::new(false),
    )
    .unwrap();
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("stdout marker"));
    assert!(String::from_utf8_lossy(&output.stderr).contains("stderr marker"));
    let output = run(
        &mut child("failure"),
        Duration::from_secs(5),
        65536,
        &AtomicBool::new(false),
    )
    .unwrap();
    assert_eq!(output.status.code(), Some(17));
}

#[test]
fn terminates_a_stalled_child_on_deadline() {
    let start = Instant::now();
    let result = run(
        &mut child("sleep"),
        Duration::from_millis(100),
        65536,
        &AtomicBool::new(false),
    );
    assert_eq!(result.unwrap_err(), ProcessError::Timeout);
    assert!(start.elapsed() < Duration::from_secs(2));
}

#[test]
fn limits_both_output_streams_including_fast_exiting_children() {
    for mode in ["flood", "stderr"] {
        assert_eq!(
            run(
                &mut child(mode),
                Duration::from_secs(5),
                4096,
                &AtomicBool::new(false)
            )
            .unwrap_err(),
            ProcessError::OutputLimit
        );
    }
}

#[test]
fn cancellation_works_before_launch_and_during_execution() {
    assert_eq!(
        run(
            &mut child("sleep"),
            Duration::from_secs(5),
            4096,
            &AtomicBool::new(true)
        )
        .unwrap_err(),
        ProcessError::Cancelled
    );
    let cancelled = Arc::new(AtomicBool::new(false));
    let signal = cancelled.clone();
    let thread = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(100));
        signal.store(true, Ordering::Relaxed);
    });
    let result = run(
        &mut child("sleep"),
        Duration::from_secs(5),
        4096,
        &cancelled,
    );
    thread.join().unwrap();
    assert_eq!(result.unwrap_err(), ProcessError::Cancelled);
}
