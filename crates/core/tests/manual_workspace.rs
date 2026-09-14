use repodeck_core::{scanner::ScanOptions, workspace::collect};
use std::{collections::BTreeSet, fs, path::Path, sync::atomic::AtomicBool};

#[test]
#[ignore = "Set REPODECK_FIXTURE_MANIFEST to a freshly generated manual fixture manifest"]
fn discovers_manual_fixture_and_checks_branch_and_change_states() {
    let manifest_path = std::env::var("REPODECK_FIXTURE_MANIFEST").unwrap();
    let manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(manifest_path).unwrap()).unwrap();
    let root = Path::new(manifest["workspace"].as_str().unwrap());
    let expected = manifest["repositories"].as_array().unwrap();
    let snapshot = collect(
        root,
        &ScanOptions::default(),
        &AtomicBool::new(false),
        |_| {},
    )
    .unwrap();
    assert!(snapshot.warnings.is_empty(), "{:?}", snapshot.warnings);
    let found: BTreeSet<_> = snapshot
        .repositories
        .iter()
        .map(|r| r.relative_path.as_str())
        .collect();
    let wanted: BTreeSet<_> = expected
        .iter()
        .map(|r| r["path"].as_str().unwrap())
        .collect();
    assert_eq!(found, wanted);
    for case in expected {
        let relative = case["path"].as_str().unwrap();
        let result = snapshot
            .repositories
            .iter()
            .find(|r| r.relative_path == relative)
            .unwrap();
        assert!(result.error.is_none(), "{relative}: {:?}", result.error);
        let status = result.status.as_ref().unwrap();
        assert_eq!(
            status.branch.as_deref(),
            case["branch"].as_str(),
            "{relative}"
        );
        assert_eq!(status.detached, case["branch"].is_null(), "{relative}");
        let expected_codes: Vec<_> = case["status"]
            .as_str()
            .unwrap()
            .lines()
            .map(|line| &line[..2])
            .collect();
        let actual_codes: Vec<_> = status
            .changes
            .iter()
            .filter(|c| c.index != '!')
            .map(|c| format!("{}{}", c.index, c.worktree))
            .collect();
        assert_eq!(actual_codes, expected_codes, "{relative}");
    }
    assert!(snapshot
        .entries
        .iter()
        .any(|e| e.path == "08-not-a-repository/design/brief.md" && !e.repository));
    assert!(snapshot
        .entries
        .iter()
        .any(|e| e.path.ends_with(".claude/settings.json") && e.agent_config));
    assert!(!snapshot
        .entries
        .iter()
        .any(|e| e.path.contains("/node_modules/")));
    println!(
        "Verified {} repositories, {} entries, branch/change states and non-Git/agent files",
        found.len(),
        snapshot.entries.len()
    );
}
