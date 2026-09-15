use crate::{
    repository,
    scanner::{self, ScanOptions},
};
use notify_debouncer_mini::{
    notify::{self, Watcher},
    Config, DebounceEventResult, Debouncer,
};
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

#[derive(Debug, Serialize)]
pub struct WatchNotice {
    pub error: Option<String>,
}

pub struct WorkspaceWatch {
    _watcher: Debouncer<ChangesOnly>,
}

// Reading files during a scan must not generate another scan on access-reporting backends.
struct ChangesOnly(notify::RecommendedWatcher);
impl Watcher for ChangesOnly {
    fn new<F: notify::EventHandler>(
        mut handler: F,
        config: notify::Config,
    ) -> notify::Result<Self> {
        notify::RecommendedWatcher::new(
            move |event: notify::Result<notify::Event>| {
                if !matches!(&event, Ok(event) if event.kind.is_access()) {
                    handler.handle_event(event);
                }
            },
            config,
        )
        .map(Self)
    }
    fn watch(&mut self, path: &Path, mode: notify::RecursiveMode) -> notify::Result<()> {
        self.0.watch(path, mode)
    }
    fn unwatch(&mut self, path: &Path) -> notify::Result<()> {
        self.0.unwatch(path)
    }
    fn kind() -> notify::WatcherKind {
        notify::RecommendedWatcher::kind()
    }
}

pub fn start(
    root: &Path,
    excluded: Vec<String>,
    on_change: impl FnMut(WatchNotice) + Send + 'static,
) -> Result<WorkspaceWatch, String> {
    start_with_options(
        root,
        &ScanOptions {
            excluded,
            ..Default::default()
        },
        on_change,
    )
}

fn metadata_path(root: &Path, option: &str) -> Result<PathBuf, String> {
    let output = repository::run_output(root, &["rev-parse", "--path-format=absolute", option])?;
    if !output.status.success() {
        return Err("Cannot locate worktree metadata; use Refresh".into());
    }
    let value = String::from_utf8(output.stdout).map_err(|_| "Invalid worktree metadata path")?;
    let value = value.strip_suffix('\n').unwrap_or(&value);
    let value = value.strip_suffix('\r').unwrap_or(value);
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err("Invalid worktree metadata path".into());
    }
    path.canonicalize()
        .map_err(|_| "Worktree metadata unavailable; use Refresh".into())
}

pub fn start_with_options(
    root: &Path,
    options: &ScanOptions,
    mut on_change: impl FnMut(WatchNotice) + Send + 'static,
) -> Result<WorkspaceWatch, String> {
    let root = root
        .canonicalize()
        .map_err(|_| "Workspace cannot be watched")?;
    if !root.is_dir() {
        return Err("Select a directory to watch".into());
    }
    let mut metadata = Vec::new();
    for entry in scanner::scan(&root, options, |_| {})?
        .entries
        .iter()
        .filter(|entry| entry.repository)
    {
        let checkout = root.join(&entry.path);
        if !checkout.join(".git").is_file() {
            continue;
        }
        let git_dir = metadata_path(&checkout, "--absolute-git-dir")?;
        let common_dir = metadata_path(&checkout, "--git-common-dir")?;
        metadata.push((git_dir, notify::RecursiveMode::NonRecursive));
        for child in ["refs", "reftable"] {
            let path = common_dir.join(child);
            if path.is_dir() {
                metadata.push((path, notify::RecursiveMode::Recursive));
            }
        }
        metadata.push((common_dir, notify::RecursiveMode::NonRecursive));
    }
    metadata.sort_by(|a, b| a.0.cmp(&b.0));
    metadata.dedup_by(|a, b| a.0 == b.0);
    let metadata_roots: Vec<_> = metadata.iter().map(|(path, _)| path.clone()).collect();
    let excluded = options.excluded.clone();
    let watched_root = root.clone();
    let trace = std::env::var_os("REPODECK_TEST_WATCH_TRACE").is_some();
    let config = Config::default()
        .with_timeout(Duration::from_millis(350))
        .with_batch_mode(true)
        .with_notify_config(notify::Config::default().with_follow_symlinks(false));
    let mut watcher = notify_debouncer_mini::new_debouncer_opt::<_, ChangesOnly>(
        config,
        move |result: DebounceEventResult| match result {
            Ok(events) => {
                if trace {
                    eprintln!("watch root={watched_root:?} events={events:?}");
                }
                let relevant = events.iter().any(|event| {
                    metadata_roots
                        .iter()
                        .any(|path| event.path.starts_with(path))
                        || event
                            .path
                            .strip_prefix(&watched_root)
                            .is_ok_and(|relative| {
                                !relative.components().any(|part| {
                                    let name = part.as_os_str().to_string_lossy();
                                    name != ".git" && excluded.iter().any(|item| item == &name)
                                })
                            })
                });
                if relevant {
                    on_change(WatchNotice { error: None });
                }
            }
            Err(_) => on_change(WatchNotice {
                error: Some("Automatic updates failed; use Refresh".into()),
            }),
        },
    )
    .map_err(|_| "Cannot start automatic updates; use Refresh")?;
    watcher
        .watcher()
        .watch(&root, notify::RecursiveMode::Recursive)
        .map_err(|_| "Cannot watch workspace; use Refresh")?;
    for (path, mode) in metadata {
        watcher
            .watcher()
            .watch(&path, mode)
            .map_err(|_| "Cannot watch worktree metadata; use Refresh")?;
    }
    Ok(WorkspaceWatch { _watcher: watcher })
}
