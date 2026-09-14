use repodeck_core::files::{preview, resolve, Preview};
use std::fs;

#[test]
fn previews_existing_text_including_hidden_agent_config() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join(".claude")).unwrap();
    fs::write(
        dir.path().join(".claude/settings.json"),
        "{\"enabled\":true}\n",
    )
    .unwrap();
    match preview(dir.path(), ".claude/settings.json").unwrap() {
        Preview::Text { content } => assert_eq!(content, "{\"enabled\":true}\n"),
        other => panic!("Unexpected preview: {other:?}"),
    }
}

#[test]
fn classifies_binary_and_large_files_without_returning_contents() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("binary"), [0, 1, 2, 3]).unwrap();
    fs::write(dir.path().join("large"), vec![b'a'; 1_048_577]).unwrap();
    assert!(matches!(
        preview(dir.path(), "binary").unwrap(),
        Preview::Binary { size: 4 }
    ));
    assert!(matches!(
        preview(dir.path(), "large").unwrap(),
        Preview::TooLarge {
            size: 1_048_577,
            ..
        }
    ));
}

#[test]
fn rejects_traversal_absolute_paths_git_internals_and_windows_streams() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("file"), "text").unwrap();
    for path in [
        "../outside",
        "folder/../../outside",
        "/etc/passwd",
        "C:\\Windows\\win.ini",
        ".git/config",
        "repo/.git/index",
        "file:stream",
        "",
        ".",
    ] {
        assert!(resolve(dir.path(), path).is_err(), "Allowed: {path}");
    }
    assert!(preview(dir.path(), "missing").is_err());
}

#[test]
fn rejects_link_escape_from_selected_workspace() {
    let dir = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("secret.txt"), "outside").unwrap();
    let link = dir.path().join("linked");
    #[cfg(windows)]
    {
        let output = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(&link)
            .arg(outside.path())
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    #[cfg(unix)]
    std::os::unix::fs::symlink(outside.path(), &link).unwrap();
    assert!(preview(dir.path(), "linked/secret.txt").is_err());
}
