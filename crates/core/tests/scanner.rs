use repodeck_core::scanner::{scan, ScanOptions};
use std::{fs, process::Command};

fn copilot_fixture(root: &std::path::Path) {
    for scope in ["", "nested/repository/"] {
        let github = root.join(scope).join(".github");
        fs::create_dir_all(github.join("workflows")).unwrap();
        fs::write(github.join("copilot-instructions.md"), "Project guidance\n").unwrap();
        fs::write(github.join("private.txt"), "Not agent configuration\n").unwrap();
        fs::write(github.join("workflows/AGENTS.md"), "Not in scope\n").unwrap();
    }
    fs::create_dir_all(root.join(".hidden/.github")).unwrap();
    fs::write(
        root.join(".hidden/.github/copilot-instructions.md"),
        "Hidden\n",
    )
    .unwrap();
    assert!(Command::new("git")
        .arg("init")
        .arg(root.join("nested/repository"))
        .output()
        .unwrap()
        .status
        .success());
}

#[test]
fn copilot_defaults_reach_workspace_and_nested_instructions_without_other_github_files() {
    let dir = tempfile::tempdir().unwrap();
    copilot_fixture(dir.path());
    let mut streamed = Vec::new();
    let result = scan(dir.path(), &ScanOptions::default(), |entry| {
        streamed.push(entry.path.clone());
    })
    .unwrap();
    let mut agents: Vec<_> = result
        .entries
        .iter()
        .filter(|e| e.agent_config)
        .map(|e| e.path.as_str())
        .collect();
    agents.sort();
    assert_eq!(
        agents,
        [
            ".github/copilot-instructions.md",
            "nested/repository/.github/copilot-instructions.md"
        ]
    );
    assert_eq!(
        streamed,
        result
            .entries
            .iter()
            .map(|e| e.path.clone())
            .collect::<Vec<_>>()
    );
    assert!(result
        .entries
        .iter()
        .any(|e| e.path == "nested/repository" && e.repository));
    assert!(result
        .entries
        .iter()
        .filter(|e| e.path.contains(".github/"))
        .all(|e| e.path.ends_with(".github/copilot-instructions.md") && !e.directory));
    assert!(!result.entries.iter().any(|e| e.path.starts_with(".hidden")));
    assert!(result.warnings.is_empty());
}

#[test]
fn copilot_default_exception_stays_at_workspace_and_repository_roots() {
    let dir = tempfile::tempdir().unwrap();
    let ordinary = dir.path().join("ordinary/.github");
    fs::create_dir_all(&ordinary).unwrap();
    fs::write(
        ordinary.join("copilot-instructions.md"),
        "Not repository guidance\n",
    )
    .unwrap();
    fs::write(dir.path().join("ordinary/visible.txt"), "Visible\n").unwrap();

    let result = scan(dir.path(), &ScanOptions::default(), |_| {}).unwrap();

    assert!(result
        .entries
        .iter()
        .any(|entry| entry.path == "ordinary/visible.txt"));
    assert!(!result
        .entries
        .iter()
        .any(|entry| entry.path.starts_with("ordinary/.github")));
}

#[test]
fn copilot_inventory_flows_through_workspace_events_and_both_report_formats() {
    use repodeck_core::{report, scanner::Scan, workspace};
    use std::sync::atomic::AtomicBool;
    let dir = tempfile::tempdir().unwrap();
    copilot_fixture(dir.path());
    let mut streamed = Vec::new();
    let snapshot = workspace::collect(
        dir.path(),
        &ScanOptions::default(),
        &AtomicBool::new(false),
        |event| {
            streamed.extend(
                event
                    .entries
                    .into_iter()
                    .filter(|e| e.agent_config)
                    .map(|e| e.path),
            );
        },
    )
    .unwrap();
    let scan = Scan {
        entries: snapshot.entries,
        warnings: snapshot.warnings,
    };
    let parsed: serde_json::Value =
        serde_json::from_str(&report::json("Fixture", &scan, &[]).unwrap()).unwrap();
    let markdown = report::markdown("Fixture", &scan, &[]);
    let section = markdown.split("## Agent Configurations\n").nth(1).unwrap();
    for expected in [
        ".github/copilot-instructions.md",
        "nested/repository/.github/copilot-instructions.md",
    ] {
        assert!(streamed.iter().any(|path| path == expected));
        assert!(parsed["agentConfigs"]
            .as_array()
            .unwrap()
            .iter()
            .any(|path| path == expected));
        assert!(parsed["files"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["path"] == expected && entry["agentConfig"] == true));
        assert!(section.contains(expected));
    }
    assert_eq!(streamed.len(), 2);
    assert_eq!(parsed["agentConfigs"].as_array().unwrap().len(), 2);
    assert!(!markdown.contains("private.txt"));
    assert!(!markdown.contains("workflows"));
}

#[test]
fn copilot_discovery_honors_explicit_exclusions_and_show_hidden() {
    let dir = tempfile::tempdir().unwrap();
    copilot_fixture(dir.path());
    for excluded in [".github", "copilot-instructions.md"] {
        for show_hidden in [false, true] {
            let mut options = ScanOptions {
                show_hidden,
                ..Default::default()
            };
            options.excluded.push(excluded.into());
            let result = scan(dir.path(), &options, |_| {}).unwrap();
            assert!(!result
                .entries
                .iter()
                .any(|e| e.path.ends_with("copilot-instructions.md")));
        }
    }
    let result = scan(
        dir.path(),
        &ScanOptions {
            show_hidden: true,
            ..Default::default()
        },
        |_| {},
    )
    .unwrap();
    assert!(result
        .entries
        .iter()
        .any(|e| e.path == ".github/private.txt" && !e.agent_config));
    assert!(result
        .entries
        .iter()
        .any(|e| e.path == ".github/workflows" && !e.agent_config));
}

#[test]
fn copilot_discovery_preserves_depth_entry_and_cancellation_limits() {
    use repodeck_core::scanner::scan_controlled;
    use std::sync::atomic::{AtomicBool, Ordering};
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join(".github")).unwrap();
    fs::write(
        dir.path().join(".github/copilot-instructions.md"),
        "Guidance",
    )
    .unwrap();
    for options in [
        ScanOptions {
            max_depth: 1,
            ..Default::default()
        },
        ScanOptions {
            max_entries: 1,
            ..Default::default()
        },
    ] {
        let result = scan(dir.path(), &options, |_| {}).unwrap();
        assert_eq!(result.entries.len(), 1);
        assert_eq!(result.entries[0].path, ".github");
        assert!(!result.warnings.is_empty());
    }
    let cancelled = AtomicBool::new(false);
    let result = scan_controlled(dir.path(), &ScanOptions::default(), &cancelled, |_| {
        cancelled.store(true, Ordering::Relaxed);
    });
    assert_eq!(result.unwrap_err(), "Scan cancelled");
}

#[test]
fn copilot_discovery_does_not_recurse_into_a_directory_named_like_instructions() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir_all(dir.path().join(".github/copilot-instructions.md")).unwrap();
    fs::write(
        dir.path()
            .join(".github/copilot-instructions.md/private.txt"),
        "Hidden",
    )
    .unwrap();
    let result = scan(dir.path(), &ScanOptions::default(), |_| {}).unwrap();
    assert!(!result
        .entries
        .iter()
        .any(|e| e.agent_config || e.path.contains("private.txt")));
}

#[test]
fn copilot_discovery_does_not_follow_linked_github_directories() {
    let dir = tempfile::tempdir().unwrap();
    let external = tempfile::tempdir().unwrap();
    fs::write(
        external.path().join("copilot-instructions.md"),
        "External guidance",
    )
    .unwrap();
    let link = dir.path().join(".github");
    directory_link(external.path(), &link);
    let result = scan(dir.path(), &ScanOptions::default(), |_| {}).unwrap();
    #[cfg(windows)]
    fs::remove_dir(&link).unwrap();
    #[cfg(unix)]
    fs::remove_file(&link).unwrap();
    assert!(!result.entries.iter().any(|e| e.agent_config));
    assert!(result
        .warnings
        .contains(&"Linked entry not followed: .github".into()));
    assert_eq!(
        fs::read_to_string(external.path().join("copilot-instructions.md")).unwrap(),
        "External guidance"
    );
}

#[test]
fn copilot_discovery_does_not_follow_a_directory_link_named_like_instructions() {
    let dir = tempfile::tempdir().unwrap();
    let external = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join(".github")).unwrap();
    fs::write(external.path().join("private.txt"), "External file").unwrap();
    let link = dir.path().join(".github/copilot-instructions.md");
    directory_link(external.path(), &link);
    let result = scan(dir.path(), &ScanOptions::default(), |_| {}).unwrap();
    #[cfg(windows)]
    fs::remove_dir(&link).unwrap();
    #[cfg(unix)]
    fs::remove_file(&link).unwrap();
    assert!(!result
        .entries
        .iter()
        .any(|e| e.path.contains("private.txt")));
    assert!(result
        .warnings
        .contains(&"Linked entry not followed: .github/copilot-instructions.md".into()));
}

#[cfg(unix)]
#[test]
fn copilot_discovery_reports_a_file_symlink_without_reading_its_target() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join(".github")).unwrap();
    let missing_target = dir.path().join("missing-private-file");
    std::os::unix::fs::symlink(
        &missing_target,
        dir.path().join(".github/copilot-instructions.md"),
    )
    .unwrap();
    let result = scan(dir.path(), &ScanOptions::default(), |_| {}).unwrap();
    assert!(result
        .warnings
        .contains(&"Linked entry not followed: .github/copilot-instructions.md".into()));
    assert!(!missing_target.exists());
    assert!(result
        .entries
        .iter()
        .any(|e| e.path == ".github/copilot-instructions.md"));
}

#[test]
fn copilot_exception_does_not_reveal_a_regular_file_named_github() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join(".github"), "Hidden ordinary file").unwrap();
    let result = scan(dir.path(), &ScanOptions::default(), |_| {}).unwrap();
    assert!(result.entries.is_empty());
}

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
