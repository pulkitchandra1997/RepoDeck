use repodeck_core::watch;
use std::{
    ffi::OsStr,
    fs,
    path::Path,
    sync::mpsc,
    time::{Duration, Instant},
};

fn git(root: &Path, args: &[&OsStr]) {
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
}

fn drain_notices(rx: &mpsc::Receiver<watch::WatchNotice>) {
    while let Ok(notice) = rx.recv_timeout(Duration::from_millis(800)) {
        assert!(notice.error.is_none());
    }
}

#[test]
fn observes_external_worktree_head_and_shared_refs() {
    let fixture = tempfile::tempdir().unwrap();
    let main = fixture.path().join("main");
    let workspace = fixture.path().join("workspace");
    fs::create_dir(&workspace).unwrap();
    let worktree = workspace.join("agent");
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
fn refreshes_metadata_watches_when_a_git_pointer_is_retargeted() {
    let fixture = tempfile::tempdir().unwrap();
    let workspace = fixture.path().join("workspace");
    let checkout = workspace.join("checkout");
    let seed_b = fixture.path().join("seed-b");
    let metadata_a = fixture.path().join("metadata-a");
    let metadata_b = fixture.path().join("metadata-b");
    fs::create_dir_all(&checkout).unwrap();
    fs::create_dir(&seed_b).unwrap();
    git(
        &checkout,
        &[
            "init".as_ref(),
            "--initial-branch=main".as_ref(),
            "--separate-git-dir".as_ref(),
            metadata_a.as_os_str(),
        ],
    );
    git(
        &seed_b,
        &[
            "init".as_ref(),
            "--initial-branch=main".as_ref(),
            "--separate-git-dir".as_ref(),
            metadata_b.as_os_str(),
        ],
    );
    git(
        fixture.path(),
        &[
            "--git-dir".as_ref(),
            metadata_b.as_os_str(),
            "config".as_ref(),
            "core.worktree".as_ref(),
            checkout.as_os_str(),
        ],
    );

    let (tx, rx) = mpsc::channel();
    let watcher = watch::start(&workspace, vec![".git".into()], move |notice| {
        let _ = tx.send(notice);
    })
    .unwrap();
    fs::write(workspace.join("watch-ready.txt"), "ready").unwrap();
    assert!(rx
        .recv_timeout(Duration::from_secs(5))
        .expect("Watcher did not observe readiness write")
        .error
        .is_none());
    drain_notices(&rx);

    fs::remove_file(checkout.join(".git")).unwrap();
    assert!(rx
        .recv_timeout(Duration::from_secs(5))
        .expect("Git pointer removal was missed")
        .error
        .is_none());
    drain_notices(&rx);
    fs::write(
        checkout.join(".git"),
        format!("gitdir: {}\n", metadata_b.display()),
    )
    .unwrap();
    assert!(rx
        .recv_timeout(Duration::from_secs(5))
        .expect("Git pointer replacement was missed")
        .error
        .is_none());
    drain_notices(&rx);

    fs::write(metadata_a.join("HEAD"), "ref: refs/heads/obsolete\n").unwrap();
    assert!(matches!(
        rx.recv_timeout(Duration::from_millis(1200)),
        Err(mpsc::RecvTimeoutError::Timeout)
    ));
    fs::write(metadata_a.join("refs/heads/obsolete"), "obsolete\n").unwrap();
    assert!(matches!(
        rx.recv_timeout(Duration::from_millis(1200)),
        Err(mpsc::RecvTimeoutError::Timeout)
    ));
    fs::write(metadata_b.join("HEAD"), "ref: refs/heads/current\n").unwrap();
    assert!(rx
        .recv_timeout(Duration::from_secs(5))
        .expect("Retargeted Git metadata change was missed")
        .error
        .is_none());

    drop(watcher);
    drain_notices(&rx);
    fs::write(metadata_b.join("HEAD"), "ref: refs/heads/after-drop\n").unwrap();
    assert!(rx.recv_timeout(Duration::from_millis(800)).is_err());
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

fn quiet_fixture() -> (
    tempfile::TempDir,
    watch::WorkspaceWatch,
    mpsc::Receiver<watch::WatchNotice>,
) {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("node_modules")).unwrap();
    fs::create_dir(dir.path().join(".git")).unwrap();
    let (tx, rx) = mpsc::channel();
    let watcher = watch::start(
        dir.path(),
        vec!["node_modules".into(), ".git".into()],
        move |notice| {
            let _ = tx.send(notice);
        },
    )
    .unwrap();
    // FSEvents can deliver root/.git creation from fixture setup after registration.
    // Establish a live stream, then isolate the excluded write from those events.
    fs::write(dir.path().join("watch-ready.txt"), "ready").unwrap();
    assert!(rx
        .recv_timeout(Duration::from_secs(5))
        .expect("Watcher did not observe readiness write")
        .error
        .is_none());
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        assert!(Instant::now() < deadline, "Watcher did not become quiet");
        match rx.recv_timeout(Duration::from_millis(1500)) {
            Ok(notice) => assert!(notice.error.is_none()),
            Err(mpsc::RecvTimeoutError::Timeout) => break,
            Err(mpsc::RecvTimeoutError::Disconnected) => panic!("Watcher disconnected"),
        }
    }
    (dir, watcher, rx)
}

#[test]
fn ignores_excluded_output() {
    let (dir, _watcher, rx) = quiet_fixture();
    fs::write(dir.path().join("node_modules/generated.txt"), "ignored").unwrap();
    assert!(matches!(
        rx.recv_timeout(Duration::from_secs(5)),
        Err(mpsc::RecvTimeoutError::Timeout)
    ));
}

#[test]
fn observes_git_metadata_in_excluded_directory() {
    let (dir, _watcher, rx) = quiet_fixture();
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
