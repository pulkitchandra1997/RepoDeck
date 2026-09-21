use repodeck_core::process::{run, ProcessError};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    process::Child,
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
        "heartbeat" => {
            let marker = PathBuf::from(std::env::var_os("REPODECK_PROCESS_MARKER").unwrap());
            let mut marker = OpenOptions::new().append(true).open(marker).unwrap();
            for _ in 0..250 {
                marker.write_all(b"x").unwrap();
                marker.flush().unwrap();
                std::thread::sleep(Duration::from_millis(20));
            }
        }
        mode @ ("tree-sleep" | "tree-flood" | "tree-exit") => {
            let marker = PathBuf::from(std::env::var_os("REPODECK_PROCESS_MARKER").unwrap());
            let mut descendant = child("heartbeat");
            descendant.env("REPODECK_PROCESS_MARKER", &marker);
            // The runner's OS containment owns this fixture after its direct parent exits.
            #[allow(clippy::zombie_processes)]
            let _descendant = descendant.spawn().unwrap();
            wait_for_marker(&marker);
            match mode {
                "tree-sleep" => std::thread::sleep(Duration::from_secs(5)),
                "tree-flood" => {
                    let _ = std::io::stdout().write_all(&vec![b'x'; 200_000]);
                    std::thread::sleep(Duration::from_secs(5));
                }
                "tree-exit" => {}
                _ => unreachable!(),
            }
        }
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

fn tree_child(mode: &str, marker: &Path) -> Command {
    fs::write(marker, []).unwrap();
    let mut command = child(mode);
    command.env("REPODECK_PROCESS_MARKER", marker);
    command
}

fn wait_for_marker(marker: &Path) {
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        if fs::metadata(marker).is_ok_and(|metadata| metadata.len() > 0) {
            return;
        }
        assert!(Instant::now() < deadline, "fixture marker was not created");
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn assert_marker_stops(marker: &Path) {
    std::thread::sleep(Duration::from_millis(100));
    let stopped_at = fs::metadata(marker)
        .unwrap_or_else(|error| {
            let parent = marker.parent().unwrap();
            let entries = fs::read_dir(parent)
                .map(|entries| {
                    entries
                        .filter_map(|entry| entry.ok().map(|entry| entry.file_name()))
                        .collect::<Vec<_>>()
                })
                .ok();
            panic!(
                "owned marker {} disappeared: {error}; parent exists: {}; entries: {entries:?}",
                marker.display(),
                parent.exists()
            );
        })
        .len();
    std::thread::sleep(Duration::from_millis(150));
    assert_eq!(fs::metadata(marker).unwrap().len(), stopped_at);
}

struct ExactChild(Child);

impl Drop for ExactChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
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

#[test]
fn timeout_terminates_owned_descendants_but_not_an_unrelated_process() {
    let root = tempfile::tempdir().unwrap();
    let owned_marker = root.path().join("owned");
    let control_marker = root.path().join("control");
    let mut control = child("heartbeat");
    fs::write(&control_marker, []).unwrap();
    control.env("REPODECK_PROCESS_MARKER", &control_marker);
    let mut control = ExactChild(control.spawn().unwrap());
    wait_for_marker(&control_marker);

    let result = run(
        &mut tree_child("tree-sleep", &owned_marker),
        Duration::from_millis(250),
        4096,
        &AtomicBool::new(false),
    );

    assert_eq!(result.unwrap_err(), ProcessError::Timeout);
    assert_marker_stops(&owned_marker);
    let control_before = fs::metadata(&control_marker).unwrap().len();
    std::thread::sleep(Duration::from_millis(100));
    assert!(fs::metadata(&control_marker).unwrap().len() > control_before);
    control.0.kill().unwrap();
    control.0.wait().unwrap();
}

#[test]
fn cancellation_terminates_owned_descendants() {
    let root = tempfile::tempdir().unwrap();
    let marker = root.path().join("cancelled");
    let cancelled = Arc::new(AtomicBool::new(false));
    let signal = cancelled.clone();
    let thread = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(250));
        signal.store(true, Ordering::Relaxed);
    });

    let result = run(
        &mut tree_child("tree-sleep", &marker),
        Duration::from_secs(5),
        4096,
        &cancelled,
    );

    thread.join().unwrap();
    assert_eq!(result.unwrap_err(), ProcessError::Cancelled);
    assert_marker_stops(&marker);
}

#[test]
fn output_limit_terminates_owned_descendants() {
    let root = tempfile::tempdir().unwrap();
    let marker = root.path().join("overflow");

    let result = run(
        &mut tree_child("tree-flood", &marker),
        Duration::from_secs(5),
        4096,
        &AtomicBool::new(false),
    );

    assert_eq!(result.unwrap_err(), ProcessError::OutputLimit);
    assert_marker_stops(&marker);
}

#[test]
fn parent_exit_does_not_release_owned_descendants() {
    let root = tempfile::tempdir().unwrap();
    let marker = root.path().join("orphan");

    let result = run(
        &mut tree_child("tree-exit", &marker),
        Duration::from_millis(250),
        4096,
        &AtomicBool::new(false),
    );

    assert_eq!(result.unwrap_err(), ProcessError::Timeout);
    assert_marker_stops(&marker);
}
