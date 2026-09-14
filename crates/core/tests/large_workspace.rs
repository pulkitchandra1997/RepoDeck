use repodeck_core::{scanner::ScanOptions, workspace};
use std::{
    collections::HashSet,
    fs,
    path::Path,
    process::Command,
    sync::atomic::{AtomicBool, Ordering},
    time::Instant,
};

fn git(root: &Path, args: &[&str]) {
    let result = Command::new("git")
        .args(["-c", "core.hooksPath=", "-c", "commit.gpgSign=false"])
        .args([
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
        ])
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
}

#[test]
#[ignore = "Creates 20,000 files; run cargo test -p repodeck-core --release --test large_workspace -- --ignored --nocapture"]
fn measures_large_mixed_workspace_streaming_and_cancellation() {
    const REPOSITORIES: usize = 20;
    const FILES_PER_REPOSITORY: usize = 1000;
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path();
    for repo in 0..REPOSITORIES {
        let directory = root.join(format!("service-{repo:02}"));
        fs::create_dir(&directory).unwrap();
        git(&directory, &["init", "--initial-branch=main"]);
        fs::write(directory.join("README.md"), "Tracked fixture\n").unwrap();
        git(&directory, &["add", "README.md"]);
        git(&directory, &["commit", "-m", "Fixture"]);
        let sources = directory.join("src");
        fs::create_dir(&sources).unwrap();
        for file in 0..FILES_PER_REPOSITORY {
            fs::write(
                sources.join(format!("file-{file:04}.txt")),
                "Fixture content\n",
            )
            .unwrap();
        }
    }
    fs::create_dir(root.join("notes")).unwrap();
    fs::write(root.join("notes/design.md"), "Non-Git notes\n").unwrap();
    fs::create_dir(root.join(".claude")).unwrap();
    fs::write(root.join(".claude/settings.json"), "{}\n").unwrap();
    fs::create_dir(root.join("node_modules")).unwrap();
    fs::write(root.join("node_modules/excluded.txt"), "Excluded\n").unwrap();
    let options = ScanOptions::default();
    for trial in 1..=3 {
        let started = Instant::now();
        let mut first_batch = None;
        let mut paths = HashSet::new();
        let mut batches = 0;
        let mut inspected = 0;
        let snapshot = workspace::collect(root, &options, &AtomicBool::new(false), |event| {
            assert!(event.entries.len() <= 128);
            if !event.entries.is_empty() {
                first_batch.get_or_insert_with(|| started.elapsed());
                batches += 1;
            }
            for entry in event.entries {
                assert!(paths.insert(entry.path), "Duplicate streamed path");
            }
            if event.repository.is_some() {
                inspected += 1;
            }
        })
        .unwrap();
        let elapsed = started.elapsed();
        assert!(snapshot.warnings.is_empty());
        assert_eq!(snapshot.repositories.len(), REPOSITORIES);
        assert_eq!(inspected, REPOSITORIES);
        assert_eq!(paths.len(), snapshot.entries.len());
        assert!(snapshot
            .entries
            .iter()
            .all(|entry| paths.contains(&entry.path)));
        assert_eq!(
            snapshot
                .entries
                .iter()
                .filter(|entry| entry.path.ends_with(".txt"))
                .count(),
            REPOSITORIES * FILES_PER_REPOSITORY
        );
        assert!(paths.contains("notes/design.md"));
        assert!(snapshot
            .entries
            .iter()
            .any(|entry| entry.path == ".claude/settings.json" && entry.agent_config));
        assert!(!paths.iter().any(|path| path.starts_with("node_modules/")));
        for repository in &snapshot.repositories {
            assert!(repository.error.is_none(), "{:?}", repository.error);
            assert_eq!(
                repository.status.as_ref().unwrap().changes.len(),
                FILES_PER_REPOSITORY
            );
        }
        let serialized_bytes = serde_json::to_vec(&snapshot).unwrap().len();
        println!("trial={trial} entries={} repositories={inspected} batches={batches} first_batch_ms={} total_ms={} snapshot_bytes={serialized_bytes}", snapshot.entries.len(), first_batch.unwrap().as_millis(), elapsed.as_millis());
    }
    for phase in ["discovery", "repositories"] {
        let cancelled = AtomicBool::new(false);
        let mut requested = None;
        let mut delivered = 0;
        let result = workspace::collect(root, &options, &cancelled, |event| {
            delivered += event.entries.len();
            if requested.is_none()
                && ((phase == "discovery" && delivered >= 256)
                    || (phase == "repositories" && event.repository.is_some()))
            {
                requested = Some(Instant::now());
                cancelled.store(true, Ordering::Relaxed);
            }
        });
        assert_eq!(result.unwrap_err(), "Scan cancelled");
        let latency = requested
            .expect("Cancellation point must be reached")
            .elapsed();
        if phase == "discovery" {
            assert!(delivered <= 383);
        }
        println!(
            "cancel_phase={phase} return_latency_us={} delivered_entries={delivered}",
            latency.as_micros()
        );
    }
}
