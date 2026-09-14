use repodeck_core::scanner::{scan, ScanOptions};
use std::{fs, process::Command};

#[cfg(windows)]
fn directory_link(target: &std::path::Path, link: &std::path::Path) {
    use std::os::windows::process::CommandExt;
    let result = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command",
            "New-Item -ItemType Junction -Path $env:REPODECK_TEST_LINK -Target $env:REPODECK_TEST_TARGET -ErrorAction Stop | Out-Null"])
        .env("REPODECK_TEST_LINK", link)
        .env("REPODECK_TEST_TARGET", target)
        .creation_flags(0x08000000)
        .output().unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
}

#[cfg(unix)]
fn directory_link(target: &std::path::Path, link: &std::path::Path) {
    std::os::unix::fs::symlink(target, link).unwrap();
}

#[test]
fn reports_skipped_directory_links_without_following_external_contents_or_loops() {
    let workspace = tempfile::tempdir().unwrap();
    let external = tempfile::tempdir().unwrap();
    fs::create_dir(external.path().join(".git")).unwrap();
    fs::write(external.path().join("private.txt"), "Must not be scanned\n").unwrap();
    let outside = workspace.path().join("outside");
    let cycle = workspace.path().join("cycle");
    directory_link(external.path(), &outside);
    directory_link(workspace.path(), &cycle);
    fs::write(workspace.path().join("local.txt"), "Visible\n").unwrap();
    let result = scan(workspace.path(), &ScanOptions::default(), |_| {}).unwrap();
    #[cfg(windows)]
    {
        fs::remove_dir(&outside).unwrap();
        fs::remove_dir(&cycle).unwrap();
    }
    #[cfg(unix)]
    {
        fs::remove_file(&outside).unwrap();
        fs::remove_file(&cycle).unwrap();
    }
    assert_eq!(result.entries.len(), 3);
    assert!(result.entries.iter().all(|entry| !entry.repository));
    assert!(result.entries.iter().any(|entry| entry.path == "local.txt"));
    assert!(result
        .warnings
        .contains(&"Linked entry not followed: outside".to_string()));
    assert!(result
        .warnings
        .contains(&"Linked entry not followed: cycle".to_string()));
    assert_eq!(
        fs::read_to_string(external.path().join("private.txt")).unwrap(),
        "Must not be scanned\n"
    );
}

#[test]
fn reports_a_folder_disappearing_mid_scan_and_continues_with_other_entries() {
    let workspace = tempfile::tempdir().unwrap();
    let disappearing = workspace.path().join("gone");
    fs::create_dir(&disappearing).unwrap();
    fs::write(workspace.path().join("remaining.txt"), "Visible\n").unwrap();
    let result = scan(workspace.path(), &ScanOptions::default(), |entry| {
        if entry.path == "gone" {
            fs::remove_dir(&disappearing).unwrap();
        }
    })
    .unwrap();
    assert!(result
        .entries
        .iter()
        .any(|entry| entry.path == "remaining.txt"));
    assert!(result
        .warnings
        .contains(&"Cannot read folder: gone".to_string()));
}

#[test]
fn discovers_nested_repositories_plain_files_and_hidden_agent_settings() {
    let dir = tempfile::tempdir().unwrap();
    for folder in [
        "app/api",
        "notes",
        ".claude",
        "node_modules/package",
        ".hidden",
    ] {
        fs::create_dir_all(dir.path().join(folder)).unwrap();
    }
    assert!(Command::new("git")
        .arg("init")
        .arg(dir.path().join("app/api"))
        .output()
        .unwrap()
        .status
        .success());
    fs::write(dir.path().join("notes/design.txt"), "design").unwrap();
    fs::write(dir.path().join(".claude/settings.json"), "{}").unwrap();
    fs::write(dir.path().join("AGENTS.md"), "instructions").unwrap();
    let mut emitted = 0;
    let result = scan(dir.path(), &ScanOptions::default(), |_| emitted += 1).unwrap();
    assert_eq!(emitted, result.entries.len());
    assert!(result
        .entries
        .iter()
        .any(|e| e.path == "app/api" && e.repository));
    assert!(result
        .entries
        .iter()
        .any(|e| e.path == "notes/design.txt" && e.size == 6));
    assert!(result
        .entries
        .iter()
        .any(|e| e.path == ".claude/settings.json" && e.agent_config));
    assert!(result
        .entries
        .iter()
        .any(|e| e.path == "AGENTS.md" && e.agent_config));
    assert!(!result
        .entries
        .iter()
        .any(|e| e.path.contains("node_modules")
            || e.path.contains(".git")
            || e.path == ".hidden"));
}

#[test]
fn bounds_scans_and_reports_truncation() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir_all(dir.path().join("one/two/three")).unwrap();
    fs::write(dir.path().join("one/a.txt"), "a").unwrap();
    let options = ScanOptions {
        max_entries: 1,
        ..Default::default()
    };
    let result = scan(dir.path(), &options, |_| {}).unwrap();
    assert_eq!(result.entries.len(), 1);
    assert!(!result.warnings.is_empty());
    let options = ScanOptions {
        max_depth: 1,
        ..Default::default()
    };
    let result = scan(dir.path(), &options, |_| {}).unwrap();
    assert!(result.entries.iter().any(|e| e.path == "one"));
    assert!(!result.entries.iter().any(|e| e.path == "one/two"));
    assert!(!result.warnings.is_empty());
}

#[test]
fn detects_repository_at_workspace_root_and_rejects_files_as_roots() {
    let dir = tempfile::tempdir().unwrap();
    assert!(Command::new("git")
        .arg("init")
        .arg(dir.path())
        .output()
        .unwrap()
        .status
        .success());
    let result = scan(dir.path(), &ScanOptions::default(), |_| {}).unwrap();
    assert!(result.entries.iter().any(|e| e.path == "." && e.repository));
    fs::write(dir.path().join("file"), "text").unwrap();
    assert!(scan(&dir.path().join("file"), &ScanOptions::default(), |_| {}).is_err());
}

#[test]
fn cancelled_scan_does_not_emit_entries_or_return_a_complete_snapshot() {
    use repodeck_core::scanner::scan_controlled;
    use std::sync::atomic::{AtomicBool, Ordering};
    let dir = tempfile::tempdir().unwrap();
    for index in 0..10 {
        fs::write(dir.path().join(format!("file-{index}")), "data").unwrap();
    }
    let cancelled = AtomicBool::new(true);
    let mut emitted = 0;
    assert!(
        scan_controlled(dir.path(), &ScanOptions::default(), &cancelled, |_| {
            emitted += 1
        })
        .is_err()
    );
    assert_eq!(emitted, 0);
    cancelled.store(false, Ordering::Relaxed);
    let result = scan_controlled(dir.path(), &ScanOptions::default(), &cancelled, |_| {
        emitted += 1;
        cancelled.store(true, Ordering::Relaxed);
    });
    assert_eq!(emitted, 1);
    assert!(result.is_err());
}
