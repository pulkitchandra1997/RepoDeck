use repodeck_core::{scanner::ScanOptions, workspace};
use std::{
    fs,
    process::Command,
    sync::atomic::{AtomicBool, Ordering},
};

#[test]
fn streams_discovery_batches_and_repository_results_before_returning() {
    let dir = tempfile::tempdir().unwrap();
    assert!(Command::new("git")
        .arg("init")
        .arg(dir.path())
        .output()
        .unwrap()
        .status
        .success());
    for i in 0..260 {
        fs::write(dir.path().join(format!("file-{i}.txt")), "data").unwrap();
    }
    let mut events = Vec::new();
    let snapshot = workspace::collect(
        dir.path(),
        &ScanOptions::default(),
        &AtomicBool::new(false),
        |event| events.push(event),
    )
    .unwrap();
    assert_eq!(events[0].phase, "discovery");
    assert_eq!(events[0].entry_count, 0);
    assert!(
        events
            .iter()
            .filter(|event| !event.entries.is_empty())
            .count()
            >= 3
    );
    let paths: Vec<_> = events
        .iter()
        .flat_map(|event| event.entries.iter().map(|entry| &entry.path))
        .collect();
    assert_eq!(
        paths,
        snapshot
            .entries
            .iter()
            .map(|entry| &entry.path)
            .collect::<Vec<_>>()
    );
    assert!(events.iter().all(|event| event.entries.len() <= 128));
    let last = events.last().unwrap();
    assert_eq!(last.phase, "repositories");
    assert_eq!(last.entry_count, snapshot.entries.len());
    assert_eq!(last.repository_count, 1);
    assert_eq!(last.inspected_count, 1);
    assert_eq!(last.repository.as_ref().unwrap().relative_path, ".");
    assert!(last.repository.as_ref().unwrap().status.is_some());
}

#[test]
fn cancellation_after_partial_delivery_does_not_return_a_completed_snapshot() {
    let dir = tempfile::tempdir().unwrap();
    for i in 0..260 {
        fs::write(dir.path().join(format!("file-{i}.txt")), "data").unwrap();
    }
    let cancelled = AtomicBool::new(false);
    let mut emitted = 0;
    let result = workspace::collect(dir.path(), &ScanOptions::default(), &cancelled, |event| {
        emitted += event.entries.len();
        if emitted > 0 {
            cancelled.store(true, Ordering::Relaxed);
        }
    });
    assert_eq!(result.unwrap_err(), "Scan cancelled");
    assert!(emitted > 0 && emitted <= 128);
}

#[test]
fn truncated_discovery_retains_warnings_in_final_snapshot() {
    let dir = tempfile::tempdir().unwrap();
    for i in 0..3 {
        fs::write(dir.path().join(format!("file-{i}")), "data").unwrap();
    }
    let options = ScanOptions {
        max_entries: 1,
        ..Default::default()
    };
    let result = workspace::collect(dir.path(), &options, &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(result.entries.len(), 1);
    assert!(!result.warnings.is_empty());
}
