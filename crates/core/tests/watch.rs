use repodeck_core::watch;
use std::{fs, sync::mpsc, time::Duration};

#[test]
fn observes_external_worktree_head_and_shared_refs() {
    let fixture = tempfile::tempdir().unwrap();
    let main = fixture.path().join("main");
    let workspace = fixture.path().join("workspace");
    fs::create_dir(&workspace).unwrap();
    let worktree = workspace.join("agent");
    let git = |root: &std::path::Path, args: &[&std::ffi::OsStr]| {
        let result = std::process::Command::new("git")
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
    };
    fs::create_dir(&main).unwrap();
    git(&main, &["init".as_ref(), "--initial-branch=main".as_ref()]);
    git(
        &main,
        &[
            "commit".as_ref(),
            "--allow-empty".as_ref(),
            "-m".as_ref(),
            "Fixture".as_ref(),
        ],
    );
    git(
        &main,
        &[
            "worktree".as_ref(),
            "add".as_ref(),
            "-b".as_ref(),
            "agent".as_ref(),
            worktree.as_os_str(),
        ],
    );
    let (tx, rx) = mpsc::channel();
    let _watcher = watch::start(&workspace, vec![".git".into()], move |notice| {
        let _ = tx.send(notice);
    })
    .unwrap();
    git(
        &worktree,
        &[
            "symbolic-ref".as_ref(),
            "HEAD".as_ref(),
            "refs/heads/next".as_ref(),
        ],
    );
    assert!(rx
        .recv_timeout(Duration::from_secs(5))
        .expect("External HEAD change was missed")
        .error
        .is_none());
    std::thread::sleep(Duration::from_millis(800));
    while rx.try_recv().is_ok() {}
    git(&main, &["branch".as_ref(), "shared-ref".as_ref()]);
    assert!(rx
        .recv_timeout(Duration::from_secs(5))
        .expect("Shared refs change was missed")
        .error
        .is_none());
}

#[test]
fn observes_real_file_changes_and_stops_when_dropped() {
    let dir = tempfile::tempdir().unwrap();
    let (tx, rx) = mpsc::channel();
    let watcher = watch::start(dir.path(), vec![], move |notice| {
        let _ = tx.send(notice);
    })
    .unwrap();
    fs::write(dir.path().join("agent-output.txt"), "changed").unwrap();
    assert!(rx
        .recv_timeout(Duration::from_secs(5))
        .unwrap()
        .error
        .is_none());
    drop(watcher);
    while rx.try_recv().is_ok() {}
    fs::write(dir.path().join("after-stop.txt"), "ignored").unwrap();
    assert!(rx.recv_timeout(Duration::from_millis(800)).is_err());
}

#[test]
fn ignores_excluded_output_but_observes_git_metadata() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("node_modules")).unwrap();
    fs::create_dir(dir.path().join(".git")).unwrap();
    let (tx, rx) = mpsc::channel();
    let _watcher = watch::start(
        dir.path(),
        vec!["node_modules".into(), ".git".into()],
        move |notice| {
            let _ = tx.send(notice);
        },
    )
    .unwrap();
    fs::write(dir.path().join("node_modules/generated.txt"), "ignored").unwrap();
    assert!(rx.recv_timeout(Duration::from_millis(1500)).is_err());
    fs::write(dir.path().join(".git/HEAD"), "ref: refs/heads/main").unwrap();
    assert!(rx
        .recv_timeout(Duration::from_secs(5))
        .unwrap()
        .error
        .is_none());
}

#[test]
fn rejects_missing_or_non_directory_watch_roots() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("plain.txt");
    fs::write(&file, "text").unwrap();
    assert!(watch::start(&file, vec![], |_| {}).is_err());
    assert!(watch::start(&dir.path().join("missing"), vec![], |_| {}).is_err());
}
