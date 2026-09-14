use repodeck_core::{
    report,
    repository::Repository,
    scanner::{Entry, Scan},
};

fn fixture() -> (Scan, Vec<Repository>) {
    (
        Scan {
            entries: vec![
                Entry {
                    path: "notes/design.md".into(),
                    directory: false,
                    repository: false,
                    agent_config: false,
                    size: 42,
                    modified_ms: 0,
                },
                Entry {
                    path: ".claude/settings.json".into(),
                    directory: false,
                    repository: false,
                    agent_config: true,
                    size: 30,
                    modified_ms: 0,
                },
            ],
            warnings: vec!["Depth limit reached".into()],
        },
        vec![Repository {
            path: "C:/Users/private-person/company/app".into(),
            branch: Some("main".into()),
            remotes: vec![
                "https://username:credential@git.example.org/team/app.git?token=credential".into(),
            ],
            ahead: 2,
            comparison_notice: "Submodule working-file changes are shown separately.".into(),
            ..Default::default()
        }],
    )
}

#[test]
fn json_export_contains_status_inventory_and_warnings_without_local_paths_or_credentials() {
    let (scan, repos) = fixture();
    let output = report::json("Application", &scan, &repos).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&output).expect("valid JSON report");
    assert_eq!(parsed["schemaVersion"], 1);
    assert_eq!(parsed["workspace"], "Application");
    assert_eq!(parsed["repositories"][0]["ahead"], 2);
    assert_eq!(
        parsed["repositories"][0]["comparisonNotice"],
        "Submodule working-file changes are shown separately."
    );
    assert_eq!(parsed["files"][0]["path"], "notes/design.md");
    assert_eq!(parsed["agentConfigs"][0], ".claude/settings.json");
    assert_eq!(parsed["warnings"][0], "Depth limit reached");
    assert!(!output.contains("private-person"));
    assert!(!output.contains("credential"));
}

#[test]
fn markdown_export_handles_markup_in_names_and_includes_actionable_status() {
    let (scan, repos) = fixture();
    let output = report::markdown("<script>alert(1)</script>", &scan, &repos);
    assert!(output.contains("main"));
    assert!(output.contains("2 ahead"));
    assert!(output.contains("Submodule working-file changes are shown separately."));
    assert!(output.contains("notes/design.md"));
    assert!(output.contains(".claude/settings.json"));
    assert!(output.contains("Depth limit reached"));
    assert!(!output.contains("<script>"));
    assert!(!output.contains("private-person"));
    assert!(!output.contains("credential"));
}
