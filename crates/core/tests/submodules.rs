use repodeck_core::{files, repository, scanner::ScanOptions, watch, workspace};
use std::{
    fs,
    path::Path,
    process::Command,
    sync::{atomic::AtomicBool, mpsc},
    time::Duration,
};

fn git(root: &Path, args: &[&str]) {
    let result = Command::new("git")
        .arg("-C")
        .arg(root)
        .args([
            "-c",
            "core.hooksPath=",
            "-c",
            "commit.gpgSign=false",
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
        ])
        .args(args)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env(
            "GIT_CONFIG_GLOBAL",
            if cfg!(windows) { "NUL" } else { "/dev/null" },
        )
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
}

#[test]
fn inspects_submodule_changes_watches_its_metadata_and_handles_deinitialization() {
    let fixture = tempfile::tempdir().unwrap();
    let source = fixture.path().join("source");
    let project = fixture.path().join("project");
    for root in [&source, &project] {
        fs::create_dir(root).unwrap();
        git(root, &["init", "--initial-branch=main"]);
    }
    fs::write(source.join("library.txt"), "Original library\n").unwrap();
    git(&source, &["add", "library.txt"]);
    git(&source, &["commit", "-m", "Library fixture"]);
    git(
        &project,
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            source.to_str().unwrap(),
            "deps/library",
        ],
    );
    git(&project, &["commit", "-m", "Add submodule"]);
    let child = project.join("deps/library");
    assert!(child.join(".git").is_file());
    let index = fs::read(project.join(".git/index")).unwrap();
    let config = fs::read(project.join(".git/config")).unwrap();
    assert!(repository::inspect(&project).unwrap().changes.is_empty());
    assert!(repository::inspect(&child).unwrap().changes.is_empty());
    git(&child, &["checkout", "--detach", "HEAD"]);
    fs::write(child.join("library.txt"), "Changed library\n").unwrap();
    fs::write(child.join("agent-note.txt"), "Agent note\n").unwrap();
    let snapshot = workspace::collect(
        &project,
        &ScanOptions::default(),
        &AtomicBool::new(false),
        |_| {},
    )
    .unwrap();
    assert!(snapshot.warnings.is_empty());
    assert_eq!(snapshot.repositories.len(), 2);
    let parent = snapshot
        .repositories
        .iter()
        .find(|repo| repo.relative_path == ".")
        .unwrap()
        .status
        .as_ref()
        .unwrap();
    assert!(parent
        .changes
        .iter()
        .any(|change| change.path == "deps/library" && change.worktree == 'M'));
    let nested = snapshot
        .repositories
        .iter()
        .find(|repo| repo.relative_path == "deps/library")
        .unwrap()
        .status
        .as_ref()
        .unwrap();
    assert_eq!(nested.changes.len(), 2);
    assert!(nested.detached);
    assert!(nested.branch.is_none());
    assert!(nested
        .changes
        .iter()
        .any(|change| change.path == "agent-note.txt" && change.index == '?'));
    assert!(repository::diff(&child, "library.txt", false)
        .unwrap()
        .contains("+Changed library"));
    assert!(snapshot
        .entries
        .iter()
        .any(|entry| entry.path == "deps/library/agent-note.txt"));
    assert!(!snapshot
        .entries
        .iter()
        .any(|entry| entry.path.split('/').any(|part| part == ".git")));
    match files::preview(&project, "deps/library/agent-note.txt").unwrap() {
        files::Preview::Text { content } => assert_eq!(content, "Agent note\n"),
        other => panic!("Expected submodule text, got {other:?}"),
    }
    assert_eq!(fs::read(project.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read(project.join(".git/config")).unwrap(), config);
    let (tx, rx) = mpsc::channel();
    let watcher = watch::start(&child, vec![".git".into()], move |notice| {
        let _ = tx.send(notice);
    })
    .unwrap();
    git(&child, &["symbolic-ref", "HEAD", "refs/heads/agent-next"]);
    assert!(rx
        .recv_timeout(Duration::from_secs(5))
        .expect("Submodule metadata change was missed")
        .error
        .is_none());
    assert_eq!(
        repository::inspect(&child).unwrap().branch.as_deref(),
        Some("agent-next")
    );
    drop(watcher);
    // Only this test-created submodule is removed, including its deliberate dirty files.
    git(
        &project,
        &["submodule", "deinit", "--force", "--", "deps/library"],
    );
    let snapshot = workspace::collect(
        &project,
        &ScanOptions::default(),
        &AtomicBool::new(false),
        |_| {},
    )
    .unwrap();
    assert_eq!(snapshot.repositories.len(), 1);
    assert_eq!(snapshot.repositories[0].relative_path, ".");
    assert!(!snapshot
        .entries
        .iter()
        .any(|entry| entry.path == "deps/library/library.txt"));
    assert_eq!(
        fs::read_to_string(source.join("library.txt")).unwrap(),
        "Original library\n"
    );
}
