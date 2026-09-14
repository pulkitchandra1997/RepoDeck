use crate::git::{parse_status, Change};
use serde::Serialize;
use std::{
    path::{Component, Path},
    process::{Command, Output},
    sync::atomic::AtomicBool,
    time::Duration,
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
}

pub(crate) fn run_output(path: &Path, args: &[&str]) -> Result<Output, String> {
    run_output_input(path, args, &[])
}

pub(crate) fn run_output_input(path: &Path, args: &[&str], input: &[u8]) -> Result<Output, String> {
    run_output_controlled(path, args, input, &AtomicBool::new(false))
}

fn run_output_controlled(
    path: &Path,
    args: &[&str],
    input: &[u8],
    cancelled: &AtomicBool,
) -> Result<Output, String> {
    let checkout = path
        .canonicalize()
        .map_err(|_| "Repository checkout is unavailable")?;
    let probe = execute(
        &checkout,
        None,
        &["rev-parse", "--show-toplevel"],
        &[],
        cancelled,
    )?;
    if !probe.status.success() {
        return Err("Cannot determine repository worktree".into());
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
    execute(&checkout, Some(&checkout), args, input, cancelled)
}

fn execute(
    path: &Path,
    worktree: Option<&Path>,
    args: &[&str],
    input: &[u8],
    cancelled: &AtomicBool,
) -> Result<Output, String> {
    let executable = crate::git_runtime::executable()
        .ok_or("Git could not start. Install Git and restart RepoDeck.")?;
    let mut command = Command::new(executable);
    command
        .arg("--no-optional-locks")
        .arg("-C")
        .arg(path)
        .args(["-c", "core.fsmonitor=false", "-c", "color.ui=false"]);
    if let Some(worktree) = worktree {
        command.arg("--work-tree").arg(worktree);
    }
    command
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_PAGER", "cat");
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
    let output = crate::process::run_input(&mut command, Duration::from_secs(30), 16 * 1024 * 1024, cancelled, input)
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
    ];
    if staged {
        args.push("--cached");
    }
    args.extend(["--", file]);
    text(path, &args, &AtomicBool::new(false))
}
