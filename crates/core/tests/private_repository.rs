use repodeck_core::{files, repository, scanner};
use std::{env, path::PathBuf};

#[test]
#[ignore = "Run through scripts/verify-private-git.cjs with its authenticated loopback fixture"]
fn inspects_authenticated_checkout_after_server_shutdown() {
    let root = PathBuf::from(env::var("REPODECK_PRIVATE_CHECKOUT").unwrap());
    let remote = env::var("REPODECK_PRIVATE_REMOTE").unwrap();
    let status = repository::inspect(&root).unwrap();
    assert_eq!(status.branch.as_deref(), Some("main"));
    assert_eq!(status.remotes, vec![remote]);
    assert_eq!((status.ahead, status.behind), (0, 0));
    assert_eq!(status.changes.len(), 2);
    assert!(status
        .changes
        .iter()
        .any(|c| c.path == "README.md" && c.worktree == 'M'));
    assert!(status
        .changes
        .iter()
        .any(|c| c.path == "notes.txt" && c.worktree == '?'));
    assert!(repository::diff(&root, "README.md", false)
        .unwrap()
        .contains("+Local change"));
    let scan = scanner::scan(&root, &scanner::ScanOptions::default(), |_| {}).unwrap();
    assert!(scan.warnings.is_empty());
    assert_eq!(
        scan.entries.iter().filter(|entry| entry.repository).count(),
        1
    );
    assert!(scan.entries.iter().any(|entry| entry.path == "notes.txt"));
    match files::preview(&root, "notes.txt").unwrap() {
        files::Preview::Text { content } => assert_eq!(content, "Untracked private note\n"),
        other => panic!("Expected text preview, got {other:?}"),
    }
}
