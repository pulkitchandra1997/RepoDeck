use repodeck_core::{
    repository::inspect,
    scanner::{scan, ScanOptions},
};
use std::{fs, path::Path, process::Command};

#[test]
#[ignore = "Requires public GitLab CLI checkout in .tools/fixtures/gitlab-cli"]
fn inspects_public_gitlab_hosted_project() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.tools/fixtures/gitlab-cli");
    let status = inspect(&root).unwrap();
    assert!(status
        .remotes
        .iter()
        .any(|remote| remote == "https://gitlab.com/gitlab-org/cli.git"));
    assert!(status.branch.is_some());
    assert!(status.changes.is_empty());
    assert_eq!((status.ahead, status.behind), (0, 0));
    let result = scan(&root, &ScanOptions::default(), |_| {}).unwrap();
    assert!(result.entries.iter().any(|entry| entry.path == "go.mod"));
    assert!(result
        .entries
        .iter()
        .any(|entry| entry.path == "cmd/glab/main.go"));
    assert!(result.warnings.is_empty());
    println!(
        "GitLab CLI: {} entries, clean status and upstream verified",
        result.entries.len()
    );
}

#[test]
#[ignore = "Requires the public Express checkout in .tools/fixtures/express"]
fn inspects_public_express_checkout() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.tools/fixtures/express");
    let status = inspect(&root).expect("Clone the public Express repository before this test");
    assert!(status
        .remotes
        .iter()
        .any(|r| r == "https://github.com/expressjs/express.git"));
    assert!(status.branch.is_some());
    assert!(status.changes.is_empty(), "Public fixture should be clean");
    assert_eq!((status.ahead, status.behind), (0, 0));
    let result = scan(&root, &ScanOptions::default(), |_| {}).unwrap();
    assert!(result.entries.iter().any(|e| e.path == "package.json"));
    assert!(result
        .entries
        .iter()
        .any(|e| e.path == "lib/application.js"));
    assert!(result.entries.iter().any(|e| e.path == "." && e.repository));
    assert!(result.warnings.is_empty());
    println!(
        "Express: {} files/folders scanned; clean Git status; upstream verified",
        result.entries.len()
    );
}

#[test]
#[ignore = "Requires public Express and Flask checkouts in .tools/fixtures"]
fn handles_two_public_projects_and_plain_files_in_one_workspace() {
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.tools/fixtures");
    let workspace = tempfile::tempdir().unwrap();
    fs::create_dir(workspace.path().join("services")).unwrap();
    fs::create_dir(workspace.path().join("notes")).unwrap();
    fs::write(
        workspace.path().join("notes/design.md"),
        "Workspace notes\n",
    )
    .unwrap();
    for name in ["express", "flask"] {
        let output = Command::new("git")
            .args(["-c", "core.hooksPath=", "clone", "--no-hardlinks"])
            .arg(fixtures.join(name))
            .arg(workspace.path().join("services").join(name))
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "Local fixture clone failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    let flask = workspace.path().join("services/flask");
    let file = flask.join("src/flask/app.py");
    let mut content = fs::read_to_string(&file).unwrap();
    content.push_str("\n# RepoDeck integration fixture\n");
    fs::write(&file, content).unwrap();
    let result = scan(workspace.path(), &ScanOptions::default(), |_| {}).unwrap();
    let repositories: Vec<_> = result
        .entries
        .iter()
        .filter(|entry| entry.repository)
        .collect();
    assert_eq!(repositories.len(), 2);
    assert!(result
        .entries
        .iter()
        .any(|entry| entry.path == "notes/design.md"));
    assert!(result
        .entries
        .iter()
        .any(|entry| entry.path == "services/flask/src/flask/app.py"));
    let status = inspect(&flask).unwrap();
    assert!(status
        .changes
        .iter()
        .any(|change| change.path == "src/flask/app.py" && change.worktree == 'M'));
    let diff = repodeck_core::repository::diff(&flask, "src/flask/app.py", false).unwrap();
    assert!(diff.contains("+# RepoDeck integration fixture"));
    assert!(inspect(&workspace.path().join("services/express"))
        .unwrap()
        .changes
        .is_empty());
    assert!(result.warnings.is_empty());
    println!("Mixed Express/Flask workspace: {} entries, two repositories, plain notes, isolated change and real diff verified", result.entries.len());
}
