use repodeck_core::repository::{diff, inspect};
use std::{fs, path::Path, process::Command};
use tempfile::TempDir;

fn git(path: &Path, args: &[&str]) {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env(
            "GIT_CONFIG_GLOBAL",
            if cfg!(windows) { "NUL" } else { "/dev/null" },
        )
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn repo() -> TempDir {
    let dir = tempfile::tempdir().unwrap();
    git(dir.path(), &["init", "-b", "main"]);
    git(dir.path(), &["config", "user.name", "RepoDeck Test"]);
    git(
        dir.path(),
        &["config", "user.email", "test@example.invalid"],
    );
    dir
}

fn commit(dir: &Path) {
    git(dir, &["add", "."]);
    git(dir, &["-c", "core.hooksPath=", "commit", "-m", "fixture"]);
}

#[test]
fn inspects_unborn_branch_and_untracked_files() {
    let dir = repo();
    fs::write(dir.path().join("hello world.txt"), "hello").unwrap();
    let status = inspect(dir.path()).unwrap();
    assert_eq!(status.branch.as_deref(), Some("main"));
    assert!(!status.detached);
    assert_eq!(status.changes[0].path, "hello world.txt");
    assert_eq!(status.changes[0].index, '?');
}

#[test]
fn reads_real_staged_and_unstaged_diffs_without_running_external_diff() {
    let dir = repo();
    fs::write(dir.path().join("file.txt"), "original\n").unwrap();
    commit(dir.path());
    fs::write(dir.path().join("file.txt"), "staged\n").unwrap();
    git(dir.path(), &["add", "file.txt"]);
    fs::write(dir.path().join("file.txt"), "unstaged\n").unwrap();
    git(
        dir.path(),
        &["config", "diff.external", "does-not-exist-repodeck"],
    );
    assert!(diff(dir.path(), "file.txt", true)
        .unwrap()
        .contains("+staged"));
    assert!(diff(dir.path(), "file.txt", false)
        .unwrap()
        .contains("+unstaged"));
    let status = inspect(dir.path()).unwrap();
    assert_eq!(
        (status.changes[0].index, status.changes[0].worktree),
        ('M', 'M')
    );
}

#[test]
fn detects_detached_head_and_linked_worktrees() {
    let dir = repo();
    fs::write(dir.path().join("file.txt"), "original\n").unwrap();
    commit(dir.path());
    let parent = tempfile::tempdir().unwrap();
    let linked = parent.path().join("linked");
    git(
        dir.path(),
        &["worktree", "add", "--detach", linked.to_str().unwrap()],
    );
    let status = inspect(&linked).unwrap();
    assert!(status.detached);
    assert_eq!(status.branch, None);
    fs::write(linked.join("file.txt"), "linked change\n").unwrap();
    assert!(diff(&linked, "file.txt", false)
        .unwrap()
        .contains("+linked change"));
    git(&linked, &["add", "file.txt"]);
    assert!(diff(&linked, "file.txt", true)
        .unwrap()
        .contains("+linked change"));
    assert!(inspect(dir.path()).unwrap().changes.is_empty());
}

fn redirected_repo() -> (TempDir, TempDir) {
    let dir = repo();
    fs::write(dir.path().join("probe.txt"), "original\n").unwrap();
    commit(dir.path());
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("probe.txt"), "outside secret\n").unwrap();
    git(
        dir.path(),
        &["config", "core.worktree", outside.path().to_str().unwrap()],
    );
    (dir, outside)
}

#[test]
fn inspect_rejects_redirected_worktree() {
    let (dir, outside) = redirected_repo();
    let config = fs::read(dir.path().join(".git/config")).unwrap();
    let result = inspect(dir.path());
    assert!(
        result.is_err(),
        "Redirected inspection succeeded: {result:?}"
    );
    assert!(result.unwrap_err().contains("worktree"));
    assert_eq!(fs::read(dir.path().join(".git/config")).unwrap(), config);
    assert_eq!(
        fs::read_to_string(outside.path().join("probe.txt")).unwrap(),
        "outside secret\n"
    );
}

#[test]
fn diff_rejects_redirected_worktree() {
    let (dir, _outside) = redirected_repo();
    for staged in [false, true] {
        let result = diff(dir.path(), "probe.txt", staged);
        assert!(result.is_err(), "Redirected diff succeeded: {result:?}");
        assert!(result.unwrap_err().contains("worktree"));
    }
}

#[test]
fn accepts_core_worktree_resolving_to_canonical_checkout() {
    let dir = repo();
    fs::write(dir.path().join("probe.txt"), "original\n").unwrap();
    commit(dir.path());
    git(dir.path(), &["config", "core.worktree", ".."]);
    fs::write(dir.path().join("probe.txt"), "inside change\n").unwrap();
    let checkout = dir.path().join(".");
    assert_eq!(inspect(&checkout).unwrap().changes[0].path, "probe.txt");
    assert!(diff(&checkout, "probe.txt", false)
        .unwrap()
        .contains("+inside change"));
}

fn repo_with_marker_filter() -> TempDir {
    let dir = repo();
    fs::write(dir.path().join("probe.txt"), "original\n").unwrap();
    fs::write(
        dir.path().join(".gitattributes"),
        "probe.txt filter=repodeck-audit\n",
    )
    .unwrap();
    commit(dir.path());
    // Install the harmless driver only after fixture creation. Its sole write is
    // a marker inside this disposable repository; cat preserves the input bytes.
    git(
        dir.path(),
        &[
            "config",
            "filter.repodeck-audit.clean",
            "printf repodeck-filter-executed > .git/repodeck-filter-marker; cat",
        ],
    );
    fs::write(dir.path().join("probe.txt"), "modified\n").unwrap();
    assert!(!dir.path().join(".git/repodeck-filter-marker").exists());
    dir
}

#[test]
fn inspection_does_not_execute_clean_filters() {
    let dir = repo_with_marker_filter();
    assert!(inspect(dir.path()).unwrap_err().contains("content filters"));
    assert_eq!(
        fs::read_to_string(dir.path().join(".git/repodeck-filter-marker")).ok(),
        None,
        "P1: inspection executed a repository-configured clean filter"
    );
}

#[test]
fn diff_does_not_execute_clean_filters() {
    let dir = repo_with_marker_filter();
    assert!(diff(dir.path(), "probe.txt", false)
        .unwrap_err()
        .contains("content filters"));
    assert_eq!(
        fs::read_to_string(dir.path().join(".git/repodeck-filter-marker")).ok(),
        None,
        "P1: unstaged diff executed a repository-configured clean filter"
    );
}

#[test]
fn process_filter_from_included_config_is_not_started() {
    let dir = repo_with_marker_filter();
    git(
        dir.path(),
        &["config", "--unset", "filter.repodeck-audit.clean"],
    );
    fs::write(dir.path().join(".git/driver.conf"),
        "[filter \"repodeck-audit\"]\nprocess = printf executed > .git/process-marker\nrequired = true\n").unwrap();
    git(dir.path(), &["config", "include.path", "driver.conf"]);
    assert!(inspect(dir.path()).unwrap_err().contains("content filters"));
    assert!(diff(dir.path(), "probe.txt", false)
        .unwrap_err()
        .contains("content filters"));
    assert!(!dir.path().join(".git/process-marker").exists());
}

#[test]
fn unused_filter_configuration_does_not_block_ordinary_files() {
    let dir = repo_with_marker_filter();
    fs::write(dir.path().join(".gitattributes"), "probe.txt -filter\n").unwrap();
    assert!(!inspect(dir.path()).unwrap().changes.is_empty());
    assert!(diff(dir.path(), "probe.txt", false)
        .unwrap()
        .contains("+modified"));
    assert!(!dir.path().join(".git/repodeck-filter-marker").exists());
}

#[test]
fn info_attributes_and_index_fallback_filters_are_blocked() {
    let dir = repo_with_marker_filter();
    fs::remove_file(dir.path().join(".gitattributes")).unwrap();
    assert!(inspect(dir.path()).unwrap_err().contains("content filters"));
    fs::write(dir.path().join(".gitattributes"), "").unwrap();
    fs::write(
        dir.path().join(".git/info/attributes"),
        "probe.txt filter=repodeck-audit\n",
    )
    .unwrap();
    assert!(diff(dir.path(), "probe.txt", true)
        .unwrap_err()
        .contains("content filters"));
    assert!(!dir.path().join(".git/repodeck-filter-marker").exists());
}

#[test]
fn ambiguous_driver_names_cannot_bypass_filter_preflight() {
    for driver in ["unset", "unspecified", "set"] {
        let dir = repo_with_marker_filter();
        fs::write(
            dir.path().join(".gitattributes"),
            format!("probe.txt filter={driver}\n"),
        )
        .unwrap();
        git(
            dir.path(),
            &[
                "config",
                &format!("filter.{driver}.clean"),
                "printf executed > .git/ambiguous-marker; cat",
            ],
        );
        assert!(inspect(dir.path()).unwrap_err().contains("content filters"));
        assert!(!dir.path().join(".git/ambiguous-marker").exists());
    }
}

#[test]
fn attribute_diagnostics_stop_comparison() {
    let dir = repo_with_marker_filter();
    fs::write(
        dir.path().join(".gitattributes"),
        "probe.txt invalid!attribute\n",
    )
    .unwrap();
    assert!(inspect(dir.path())
        .unwrap_err()
        .contains("safely inspect Git attributes"));
    assert!(!dir.path().join(".git/repodeck-filter-marker").exists());
}

#[test]
fn missing_objects_do_not_start_promisor_helpers() {
    let dir = repo();
    fs::write(dir.path().join("probe.txt"), "original\n").unwrap();
    commit(dir.path());
    let output = Command::new("git")
        .arg("-C")
        .arg(dir.path())
        .args(["rev-parse", "HEAD:probe.txt"])
        .output()
        .unwrap();
    assert!(output.status.success());
    let oid = String::from_utf8(output.stdout).unwrap();
    let oid = oid.trim();
    fs::remove_file(
        dir.path()
            .join(".git/objects")
            .join(&oid[..2])
            .join(&oid[2..]),
    )
    .unwrap();
    git(
        dir.path(),
        &[
            "config",
            "remote.origin.url",
            "ext::sh -c touch% promisor-marker",
        ],
    );
    git(dir.path(), &["config", "remote.origin.promisor", "true"]);
    git(
        dir.path(),
        &["config", "remote.origin.partialclonefilter", "blob:none"],
    );
    git(dir.path(), &["config", "protocol.ext.allow", "always"]);
    fs::write(dir.path().join("probe.txt"), "changed\n").unwrap();
    assert!(diff(dir.path(), "probe.txt", false).is_err());
    assert!(!dir.path().join("promisor-marker").exists());
}

#[test]
fn inherited_config_redirect_cannot_hide_global_filter() {
    const CHILD: &str = "REPODECK_FILTER_SECURITY_CHILD";
    if let Some(root) = std::env::var_os(CHILD) {
        let root = Path::new(&root);
        assert!(inspect(root).unwrap_err().contains("content filters"));
        assert!(!root.join(".git/global-marker").exists());
        return;
    }
    let dir = repo();
    fs::write(dir.path().join("probe.txt"), "original\n").unwrap();
    fs::write(
        dir.path().join(".gitattributes"),
        "probe.txt filter=unset\n",
    )
    .unwrap();
    commit(dir.path());
    fs::write(dir.path().join("probe.txt"), "changed\n").unwrap();
    fs::write(
        dir.path().join(".git/global.conf"),
        "[filter \"unset\"]\nclean = printf executed > .git/global-marker; cat\n",
    )
    .unwrap();
    fs::write(dir.path().join(".git/empty.conf"), "").unwrap();
    let result = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "inherited_config_redirect_cannot_hide_global_filter",
            "--nocapture",
        ])
        .env(CHILD, dir.path())
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", dir.path().join(".git/global.conf"))
        .env("GIT_CONFIG", dir.path().join(".git/empty.conf"))
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr)
    );
    assert!(!dir.path().join(".git/global-marker").exists());
}

#[test]
fn supports_arbitrary_hosts_and_redacts_remote_credentials() {
    let dir = repo();
    git(
        dir.path(),
        &[
            "remote",
            "add",
            "origin",
            "https://alice:secret@git.example.org/team/app.git?token=hidden",
        ],
    );
    git(
        dir.path(),
        &["remote", "add", "secondary", "git@gitlab.com:team/app.git"],
    );
    let status = inspect(dir.path()).unwrap();
    assert!(status
        .remotes
        .iter()
        .any(|r| r == "https://git.example.org/team/app.git"));
    assert!(status
        .remotes
        .iter()
        .any(|r| r == "git@gitlab.com:team/app.git"));
    let json = serde_json::to_string(&status).unwrap();
    assert_eq!(
        status.origin_url.as_deref(),
        Some("https://git.example.org/team/app.git")
    );
    assert!(!json.contains("secret"));
    assert!(!json.contains("hidden"));
}

#[test]
fn rejects_non_repositories_and_diff_paths_outside_repository() {
    let dir = tempfile::tempdir().unwrap();
    assert!(inspect(dir.path()).is_err());
    let dir = repo();
    assert!(diff(dir.path(), "../outside", false).is_err());
    assert!(diff(dir.path(), ":(glob)*", false).is_err());
}

#[test]
fn counts_both_sides_of_a_diverged_upstream() {
    let dir = repo();
    fs::write(dir.path().join("base.txt"), "base\n").unwrap();
    commit(dir.path());
    git(dir.path(), &["checkout", "-b", "upstream"]);
    fs::write(dir.path().join("remote.txt"), "remote\n").unwrap();
    commit(dir.path());
    git(dir.path(), &["checkout", "main"]);
    fs::write(dir.path().join("local.txt"), "local\n").unwrap();
    commit(dir.path());
    git(
        dir.path(),
        &["branch", "--set-upstream-to=upstream", "main"],
    );
    let status = inspect(dir.path()).unwrap();
    assert_eq!(status.upstream.as_deref(), Some("upstream"));
    assert_eq!((status.ahead, status.behind), (1, 1));
    assert!(status.changes.is_empty());
}

#[test]
fn retains_real_merge_conflicts_without_modifying_the_worktree() {
    let dir = repo();
    let file = dir.path().join("conflict.txt");
    fs::write(&file, "base\n").unwrap();
    commit(dir.path());
    git(dir.path(), &["checkout", "-b", "topic"]);
    fs::write(&file, "topic\n").unwrap();
    commit(dir.path());
    git(dir.path(), &["checkout", "main"]);
    fs::write(&file, "main\n").unwrap();
    commit(dir.path());
    let merge = Command::new("git")
        .arg("-C")
        .arg(dir.path())
        .args(["-c", "core.hooksPath=", "merge", "--no-edit", "topic"])
        .output()
        .unwrap();
    assert_eq!(merge.status.code(), Some(1));
    let before = fs::read(&file).unwrap();
    let status = inspect(dir.path()).unwrap();
    assert_eq!(status.changes.len(), 1);
    assert_eq!(status.changes[0].path, "conflict.txt");
    assert_eq!(
        (status.changes[0].index, status.changes[0].worktree),
        ('U', 'U')
    );
    assert_eq!(fs::read(file).unwrap(), before);
}
