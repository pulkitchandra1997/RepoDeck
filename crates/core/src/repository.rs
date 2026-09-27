use crate::git::{parse_status, Change};
use serde::Serialize;
use std::{
    path::{Component, Path},
    process::{Command, Output},
    sync::atomic::AtomicBool,
    time::{Duration, Instant},
};

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Repository {
    pub path: String,
    pub branch: Option<String>,
    pub detached: bool,
    pub upstream: Option<String>,
    pub ahead: u64,
    pub behind: u64,
    pub remotes: Vec<String>,
    pub origin_url: Option<String>,
    pub changes: Vec<Change>,
    pub comparison_notice: String,
}

pub(crate) fn run_output(path: &Path, args: &[&str]) -> Result<Output, String> {
    run_output_input(path, args, &[])
}

pub(crate) fn run_output_input(path: &Path, args: &[&str], input: &[u8]) -> Result<Output, String> {
    run_output_controlled(path, args, input, &AtomicBool::new(false))
}

pub(crate) fn run_output_controlled(
    path: &Path,
    args: &[&str],
    input: &[u8],
    cancelled: &AtomicBool,
) -> Result<Output, String> {
    let deadline = Instant::now() + Duration::from_secs(30);
    let checkout = path
        .canonicalize()
        .map_err(|_| "Repository checkout is unavailable")?;
    let probe = execute(
        &checkout,
        None,
        &["rev-parse", "--show-toplevel"],
        &[],
        cancelled,
        deadline,
    )?;
    if !probe.status.success() {
        return Err("Cannot determine repository worktree. Git must support --no-lazy-fetch; upgrade Git if needed.".into());
    }
    let reported =
        String::from_utf8(probe.stdout).map_err(|_| "Repository worktree path is not UTF-8")?;
    let reported = reported.strip_suffix('\n').unwrap_or(&reported);
    let reported = reported.strip_suffix('\r').unwrap_or(reported);
    let worktree = Path::new(reported);
    if !worktree.is_absolute()
        || worktree
            .canonicalize()
            .map_err(|_| "Repository worktree is unavailable")?
            != checkout
    {
        return Err("Repository worktree does not match the selected checkout".into());
    }
    // Metadata may live elsewhere for linked worktrees. Bind only the working tree,
    // so a later core.worktree change cannot redirect this operation.
    if args.contains(&"status") || args.contains(&"diff") {
        reject_content_filters(&checkout, cancelled, deadline)?;
    }
    execute(&checkout, Some(&checkout), args, input, cancelled, deadline)
}

fn reject_content_filters(
    checkout: &Path,
    cancelled: &AtomicBool,
    deadline: Instant,
) -> Result<(), String> {
    // Ask Git to resolve attributes (including macros, index fallback, and info/
    // attributes) without converting any content or invoking filter drivers.
    let files = execute(
        checkout,
        Some(checkout),
        &["ls-files", "--cached", "-z"],
        &[],
        cancelled,
        deadline,
    )?;
    if !files.status.success() || !files.stderr.is_empty() {
        return Err("Cannot safely inspect tracked files before comparison".into());
    }
    let attributes = execute(
        checkout,
        Some(checkout),
        &["check-attr", "-z", "--stdin", "filter"],
        &files.stdout,
        cancelled,
        deadline,
    )?;
    if !attributes.status.success() || !attributes.stderr.is_empty() {
        return Err("Cannot safely inspect Git attributes before comparison".into());
    }
    if !attributes.stdout.is_empty() && !attributes.stdout.ends_with(&[0]) {
        return Err("Invalid Git attribute response; comparison stopped".into());
    }
    let fields: Vec<_> = attributes
        .stdout
        .strip_suffix(&[0])
        .unwrap_or(&[])
        .split(|b| *b == 0)
        .collect();
    if files.stdout.is_empty() && attributes.stdout.is_empty() {
        return Ok(());
    }
    if fields.len() % 3 != 0 || fields.len() / 3 != files.stdout.iter().filter(|b| **b == 0).count()
    {
        return Err("Invalid Git attribute response; comparison stopped".into());
    }
    for record in fields.as_chunks::<3>().0 {
        if record[1] != b"filter" {
            return Err("Invalid Git attribute response; comparison stopped".into());
        }
        if !matches!(record[2], b"unspecified" | b"unset") {
            return Err("Working-tree comparison unavailable: tracked files use Git content filters (including LFS). RepoDeck will not execute those filters. Inspect this checkout with your trusted Git client; file browsing remains available.".into());
        }
    }
    // Git's text protocol cannot distinguish a missing/unset attribute from a
    // string-valued driver literally named "unspecified" or "unset".
    let config = execute(
        checkout,
        Some(checkout),
        &["config", "--null", "--list", "--includes"],
        &[],
        cancelled,
        deadline,
    )?;
    if !config.status.success()
        || !config.stderr.is_empty()
        || (!config.stdout.is_empty() && !config.stdout.ends_with(&[0]))
    {
        return Err("Cannot safely inspect Git filter configuration".into());
    }
    for record in config.stdout.split(|b| *b == 0) {
        let key = record.split(|b| *b == b'\n').next().unwrap_or(&[]);
        if key.starts_with(b"filter.unspecified.") || key.starts_with(b"filter.unset.") {
            return Err(
                "Working-tree comparison unavailable: ambiguous Git content filters are configured"
                    .into(),
            );
        }
    }
    Ok(())
}

fn execute(
    path: &Path,
    worktree: Option<&Path>,
    args: &[&str],
    input: &[u8],
    cancelled: &AtomicBool,
    deadline: Instant,
) -> Result<Output, String> {
    let executable = crate::git_runtime::executable()
        .ok_or("Git could not start. Install Git and restart RepoDeck.")?;
    let mut command = Command::new(executable);
    command
        .arg("--no-lazy-fetch")
        .arg("--no-optional-locks")
        .arg("-C")
        .arg(path)
        .args([
            "-c",
            "core.fsmonitor=false",
            "-c",
            "color.ui=false",
            "-c",
            "status.submoduleSummary=false",
            "-c",
            "protocol.allow=never",
        ]);
    if let Some(worktree) = worktree {
        command.arg("--work-tree").arg(worktree);
    }
    command
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_NO_LAZY_FETCH", "1")
        .env("GIT_ALLOW_PROTOCOL", "")
        .env("GIT_PAGER", "cat");
    for (key, _) in std::env::vars_os() {
        let name = key.to_string_lossy().to_ascii_uppercase();
        if name == "GIT_CONFIG"
            || name == "GIT_CONFIG_PARAMETERS"
            || name == "GIT_CONFIG_COUNT"
            || name.starts_with("GIT_CONFIG_KEY_")
            || name.starts_with("GIT_CONFIG_VALUE_")
        {
            command.env_remove(key);
        }
    }
    for key in [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_COMMON_DIR",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    ] {
        command.env_remove(key);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let timeout = deadline
        .checked_duration_since(Instant::now())
        .ok_or("Git operation exceeded the 30-second time limit")?;
    let output = crate::process::run_input(&mut command, timeout, 16 * 1024 * 1024, cancelled, input)
        .map_err(|error| match error {
            crate::process::ProcessError::Start => "Git could not start. Install Git and restart RepoDeck.",
            crate::process::ProcessError::Timeout => "Git exceeded the 30-second time limit. Try a smaller workspace or check repository health.",
            crate::process::ProcessError::OutputLimit => "Git output exceeded 16 MiB. Narrow the operation or inspect this repository in your editor.",
            crate::process::ProcessError::Cancelled => "Git operation cancelled.",
            crate::process::ProcessError::Io => "Cannot read temporary Git output. Check available disk space and permissions.",
        }.to_string())?;
    Ok(output)
}

fn run(path: &Path, args: &[&str], cancelled: &AtomicBool) -> Result<Vec<u8>, String> {
    let output = run_output_controlled(path, args, &[], cancelled)?;
    if !output.status.success() {
        return Err(format!(
            "Git {} failed (exit {}). Check repository access and configuration.",
            args.first().unwrap_or(&"command"),
            output.status.code().unwrap_or(-1)
        ));
    }
    Ok(output.stdout)
}

fn optional_text(
    path: &Path,
    args: &[&str],
    absent_code: i32,
    cancelled: &AtomicBool,
) -> Result<Option<String>, String> {
    let output = run_output_controlled(path, args, &[], cancelled)?;
    if output.status.code() == Some(absent_code) {
        return Ok(None);
    }
    if !output.status.success() {
        return Err("Git metadata query failed".into());
    }
    String::from_utf8(output.stdout)
        .map(|s| Some(s.trim_end().to_string()))
        .map_err(|_| "Git returned text that is not UTF-8".into())
}

fn text(path: &Path, args: &[&str], cancelled: &AtomicBool) -> Result<String, String> {
    String::from_utf8(run(path, args, cancelled)?)
        .map(|s| s.trim_end().to_string())
        .map_err(|_| "Git returned text that is not UTF-8".into())
}

fn redact_remote(remote: &str) -> String {
    let clean = remote.split(['?', '#']).next().unwrap_or("");
    if let Some((scheme, rest)) = clean.split_once("://") {
        let (authority, suffix) = rest.split_once('/').unwrap_or((rest, ""));
        let host = authority.rsplit('@').next().unwrap_or(authority);
        return format!("{scheme}://{host}/{suffix}");
    }
    clean.to_string()
}

pub fn inspect(path: &Path) -> Result<Repository, String> {
    inspect_controlled(path, &AtomicBool::new(false))
}

pub fn inspect_controlled(path: &Path, cancelled: &AtomicBool) -> Result<Repository, String> {
    let root = text(path, &["rev-parse", "--show-toplevel"], cancelled)?;
    let branch = optional_text(
        path,
        &["symbolic-ref", "--quiet", "--short", "HEAD"],
        1,
        cancelled,
    )?;
    let upstream = optional_text(
        path,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
        128,
        cancelled,
    )?;
    let (ahead, behind) = if upstream.is_some() {
        let counts = text(
            path,
            &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
            cancelled,
        )?;
        let mut counts = counts.split_whitespace();
        (
            counts
                .next()
                .and_then(|v| v.parse().ok())
                .ok_or("Invalid ahead count")?,
            counts
                .next()
                .and_then(|v| v.parse().ok())
                .ok_or("Invalid behind count")?,
        )
    } else {
        (0, 0)
    };
    let mut remotes = Vec::new();
    let mut origin_url = None;
    for name in text(path, &["remote"], cancelled)?.lines() {
        for remote in text(path, &["remote", "get-url", "--all", name], cancelled)?.lines() {
            if name == "origin" && origin_url.is_none() {
                origin_url = Some(redact_remote(remote));
            }
            remotes.push(redact_remote(remote));
        }
    }
    let changes = parse_status(&run(
        path,
        &[
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--ignored=matching",
            "--ignore-submodules=dirty",
        ],
        cancelled,
    )?)?;
    Ok(Repository {
        path: root,
        detached: branch.is_none(),
        branch,
        upstream,
        ahead,
        behind,
        remotes,
        origin_url,
        changes,
        comparison_notice: "Submodule working-file changes are shown in each submodule's own repository entry, not in its parent. Git content-filter comparisons are blocked; repository metadata must not be maliciously changed during inspection.".into(),
    })
}

pub fn diff(path: &Path, file: &str, staged: bool) -> Result<String, String> {
    if file.is_empty()
        || file.starts_with(':')
        || Path::new(file)
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("Select a file within this repository".into());
    }
    let mut args = vec![
        "--literal-pathspecs",
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--ignore-submodules=dirty",
        "--submodule=short",
    ];
    if staged {
        args.push("--cached");
    }
    args.extend(["--", file]);
    text(path, &args, &AtomicBool::new(false))
}
