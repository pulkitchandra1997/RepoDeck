use repodeck_core::git_settings::{config, features, ignore_rule};
use std::{fs, path::Path, process::Command};
fn git(root: &Path, args: &[&str]) {
    assert!(Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .unwrap()
        .status
        .success());
}
#[test]
fn reads_settings_but_hides_credentials_and_custom_command_values() {
    let dir = tempfile::tempdir().unwrap();
    git(dir.path(), &["init"]);
    git(dir.path(), &["config", "core.autocrlf", "false"]);
    git(
        dir.path(),
        &["config", "credential.helper", "!echo private-token"],
    );
    git(
        dir.path(),
        &[
            "config",
            "http.https://user:private-token@example.org.extraheader",
            "Authorization: private-token",
        ],
    );
    let entries = config(dir.path()).unwrap();
    assert!(entries
        .iter()
        .any(|e| e.key == "core.autocrlf" && e.value == "false" && !e.hidden));
    assert!(entries
        .iter()
        .any(|e| e.key == "credential.helper" && e.hidden));
    assert!(!serde_json::to_string(&entries)
        .unwrap()
        .contains("private-token"));
}
#[test]
fn reports_ignore_source_line_and_pattern_and_handles_nonignored_paths() {
    let dir = tempfile::tempdir().unwrap();
    git(dir.path(), &["init"]);
    fs::write(dir.path().join(".gitignore"), "# generated\n*.log\n").unwrap();
    let rule = ignore_rule(dir.path(), "app error.log").unwrap().unwrap();
    assert_eq!(rule.source, ".gitignore");
    assert_eq!(rule.line, 2);
    assert_eq!(rule.pattern, "*.log");
    assert_eq!(rule.path, "app error.log");
    assert!(ignore_rule(dir.path(), "app.rs").unwrap().is_none());
    assert!(ignore_rule(dir.path(), "../outside").is_err());
}
#[test]
fn reports_repository_exclude_rules() {
    let dir = tempfile::tempdir().unwrap();
    git(dir.path(), &["init"]);
    fs::write(dir.path().join(".git/info/exclude"), "scratch/\n").unwrap();
    let rule = ignore_rule(dir.path(), "scratch/file.txt")
        .unwrap()
        .unwrap();
    assert!(rule
        .source
        .replace('\\', "/")
        .ends_with(".git/info/exclude"));
    assert_eq!(rule.pattern, "scratch/");
}

#[test]
fn reports_external_ignore_file_and_local_override() {
    let dir = tempfile::tempdir().unwrap();
    let external = tempfile::tempdir().unwrap();
    let ignore = external.path().join("global ignore rules");
    fs::write(&ignore, "*.cache\n").unwrap();
    git(dir.path(), &["init"]);
    git(
        dir.path(),
        &["config", "core.excludesFile", ignore.to_str().unwrap()],
    );
    let rule = ignore_rule(dir.path(), "asset.cache").unwrap().unwrap();
    assert_eq!(
        Path::new(&rule.source).canonicalize().unwrap(),
        ignore.canonicalize().unwrap()
    );
    assert_eq!(rule.line, 1);
    assert_eq!(rule.pattern, "*.cache");
    fs::write(dir.path().join(".gitignore"), "!asset.cache\n").unwrap();
    assert!(ignore_rule(dir.path(), "asset.cache").unwrap().is_none());
}

#[test]
fn preserves_tabs_newlines_and_unicode_in_ignore_queries() {
    let dir = tempfile::tempdir().unwrap();
    git(dir.path(), &["init"]);
    fs::write(dir.path().join(".gitignore"), "*.log\n").unwrap();
    for path in ["line\nbreak.log", "tab\tname.log", "日本語.log"] {
        let rule = ignore_rule(dir.path(), path).unwrap().unwrap();
        assert_eq!(rule.path, path);
        assert_eq!(rule.pattern, "*.log");
    }
}

#[test]
fn distinguishes_negation_from_an_escaped_literal_exclamation_mark() {
    let dir = tempfile::tempdir().unwrap();
    git(dir.path(), &["init"]);
    fs::write(
        dir.path().join(".gitignore"),
        "*.log\n!keep.log\n\\!important.txt\n",
    )
    .unwrap();
    assert!(ignore_rule(dir.path(), "keep.log").unwrap().is_none());
    assert_eq!(
        ignore_rule(dir.path(), "!important.txt")
            .unwrap()
            .unwrap()
            .pattern,
        "\\!important.txt"
    );
}

#[test]
fn does_not_claim_tracked_files_are_ignored() {
    let dir = tempfile::tempdir().unwrap();
    git(dir.path(), &["init"]);
    fs::write(dir.path().join("tracked.log"), "tracked").unwrap();
    git(dir.path(), &["add", "tracked.log"]);
    fs::write(dir.path().join(".gitignore"), "*.log\n").unwrap();
    assert!(ignore_rule(dir.path(), "tracked.log").unwrap().is_none());
}

#[test]
fn discovers_custom_hook_files_without_executing_them() {
    let dir = tempfile::tempdir().unwrap();
    git(dir.path(), &["init"]);
    fs::create_dir(dir.path().join("custom-hooks")).unwrap();
    fs::write(
        dir.path().join("custom-hooks/pre-commit"),
        "#!/bin/sh\ntouch should-not-exist\n",
    )
    .unwrap();
    fs::write(dir.path().join("custom-hooks/pre-push.sample"), "sample").unwrap();
    git(dir.path(), &["config", "core.hooksPath", "custom-hooks"]);
    let info = features(dir.path()).unwrap();
    assert_eq!(info.hooks, vec!["pre-commit"]);
    assert!(!dir.path().join("should-not-exist").exists());
}

#[test]
fn detects_nested_lfs_attributes_without_running_filter_commands() {
    let dir = tempfile::tempdir().unwrap();
    git(dir.path(), &["init"]);
    fs::create_dir(dir.path().join("assets")).unwrap();
    fs::write(
        dir.path().join("assets/.gitattributes"),
        "*.bin filter=lfs diff=lfs merge=lfs -text\n",
    )
    .unwrap();
    fs::write(
        dir.path().join(".gitattributes"),
        "# *.png filter=lfs\n*.txt text\n",
    )
    .unwrap();
    git(
        dir.path(),
        &[
            "config",
            "filter.lfs.process",
            "nonexistent-command-must-not-run",
        ],
    );
    let info = features(dir.path()).unwrap();
    assert!(info.lfs_configured);
    assert_eq!(info.lfs_attributes, vec!["assets/.gitattributes"]);
    assert!(info.warnings.is_empty());
}
