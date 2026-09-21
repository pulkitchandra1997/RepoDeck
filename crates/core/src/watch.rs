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
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, Sender},
        Arc,
    },
    thread::{self, JoinHandle},
    time::Duration,
};

#[derive(Debug, Serialize)]
pub struct WatchNotice {
    pub error: Option<String>,
}

pub struct WorkspaceWatch {
    cancelled: Arc<AtomicBool>,
    control: Sender<Control>,
    worker: Option<JoinHandle<()>>,
}

impl Drop for WorkspaceWatch {
    fn drop(&mut self) {
        self.cancelled.store(true, Ordering::Release);
        let _ = self.control.send(Control::Stop);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

enum Control {
    Events(DebounceEventResult),
    Stop,
}

type Registration = (PathBuf, notify::RecursiveMode);

struct RegistrationSet {
    metadata: Vec<Registration>,
    pointers: Vec<PathBuf>,
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

fn registration_set(
    root: &Path,
    options: &ScanOptions,
    cancelled: &AtomicBool,
) -> Result<RegistrationSet, String> {
    let mut metadata = Vec::new();
    let mut pointers = Vec::new();
    for entry in scanner::scan_controlled(root, options, cancelled, |_| {})?
        .entries
        .iter()
        .filter(|entry| entry.repository)
    {
        if cancelled.load(Ordering::Acquire) {
            return Err("Watch cancelled".into());
        }
        let checkout = root.join(&entry.path);
        let pointer = checkout.join(".git");
        if !pointer.is_file() {
            continue;
        }
        pointers.push(pointer);
        let git_dir = metadata_path(&checkout, "--absolute-git-dir")?;
        if cancelled.load(Ordering::Acquire) {
            return Err("Watch cancelled".into());
        }
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
    pointers.sort();
    pointers.dedup();
    if cancelled.load(Ordering::Acquire) {
        return Err("Watch cancelled".into());
    }
    Ok(RegistrationSet { metadata, pointers })
}

fn reconcile_registrations(
    watcher: &mut Debouncer<ChangesOnly>,
    current: &RegistrationSet,
    next: &RegistrationSet,
) -> Result<(), ()> {
    let additions: Vec<_> = next
        .metadata
        .iter()
        .filter(|registration| !current.metadata.contains(registration))
        .cloned()
        .collect();
    let removals: Vec<_> = current
        .metadata
        .iter()
        .filter(|registration| !next.metadata.contains(registration))
        .cloned()
        .collect();
    let mut added: Vec<Registration> = Vec::new();
    for (path, mode) in &additions {
        if watcher.watcher().watch(path, *mode).is_err() {
            for (path, _) in added.iter().rev() {
                let _ = watcher.watcher().unwatch(path);
            }
            return Err(());
        }
        added.push((path.clone(), *mode));
    }
    let mut removed: Vec<Registration> = Vec::new();
    for (path, mode) in &removals {
        if watcher.watcher().unwatch(path).is_err() {
            for (path, mode) in &removed {
                let _ = watcher.watcher().watch(path, *mode);
            }
            for (path, _) in added.iter().rev() {
                let _ = watcher.watcher().unwatch(path);
            }
            return Err(());
        }
        removed.push((path.clone(), *mode));
    }
    Ok(())
}

fn touches_pointer(events: &[notify_debouncer_mini::DebouncedEvent], pointers: &[PathBuf]) -> bool {
    events.iter().any(|event| pointers.contains(&event.path))
}

fn relevant_event(
    events: &[notify_debouncer_mini::DebouncedEvent],
    registrations: &RegistrationSet,
    root: &Path,
    excluded: &[String],
) -> bool {
    events.iter().any(|event| {
        registrations
            .metadata
            .iter()
            .any(|(path, _)| event.path.starts_with(path))
            || event.path.strip_prefix(root).is_ok_and(|relative| {
                !relative.components().any(|part| {
                    let name = part.as_os_str().to_string_lossy();
                    name != ".git" && excluded.iter().any(|item| item == &name)
                })
            })
    })
}

fn report_failure(cancelled: &AtomicBool, on_change: &mut impl FnMut(WatchNotice)) {
    if !cancelled.load(Ordering::Acquire) {
        on_change(WatchNotice {
            error: Some("Automatic updates failed; use Refresh".into()),
        });
    }
}

fn run_watch(
    mut watcher: Debouncer<ChangesOnly>,
    root: PathBuf,
    options: ScanOptions,
    mut registrations: RegistrationSet,
    cancelled: Arc<AtomicBool>,
    control: Receiver<Control>,
    mut on_change: impl FnMut(WatchNotice),
) {
    while let Ok(message) = control.recv() {
        if cancelled.load(Ordering::Acquire) {
            break;
        }
        let result = match message {
            Control::Events(result) => result,
            Control::Stop => break,
        };
        match result {
            Ok(events) => {
                if touches_pointer(&events, &registrations.pointers) {
                    let next = registration_set(&root, &options, &cancelled);
                    if cancelled.load(Ordering::Acquire) {
                        break;
                    }
                    let mut next = match next {
                        Ok(next) => next,
                        Err(_) => {
                            report_failure(&cancelled, &mut on_change);
                            continue;
                        }
                    };
                    next.pointers.extend(registrations.pointers.iter().cloned());
                    next.pointers.sort();
                    next.pointers.dedup();
                    if reconcile_registrations(&mut watcher, &registrations, &next).is_err() {
                        report_failure(&cancelled, &mut on_change);
                        continue;
                    }
                    registrations = next;
                }
                if !cancelled.load(Ordering::Acquire)
                    && relevant_event(&events, &registrations, &root, &options.excluded)
                {
                    on_change(WatchNotice { error: None });
                }
            }
            Err(_) => {
                report_failure(&cancelled, &mut on_change);
            }
        }
    }
}

pub fn start_with_options(
    root: &Path,
    options: &ScanOptions,
    on_change: impl FnMut(WatchNotice) + Send + 'static,
) -> Result<WorkspaceWatch, String> {
    let root = root
        .canonicalize()
        .map_err(|_| "Workspace cannot be watched")?;
    if !root.is_dir() {
        return Err("Select a directory to watch".into());
    }
    let options = ScanOptions {
        max_depth: options.max_depth,
        excluded: options.excluded.clone(),
        show_hidden: options.show_hidden,
        max_entries: options.max_entries,
    };
    let cancelled = Arc::new(AtomicBool::new(false));
    let registrations = registration_set(&root, &options, &cancelled)?;
    let config = Config::default()
        .with_timeout(Duration::from_millis(350))
        .with_batch_mode(true)
        .with_notify_config(notify::Config::default().with_follow_symlinks(false));
    let (control_tx, control_rx) = mpsc::channel();
    let event_tx = control_tx.clone();
    let mut watcher = notify_debouncer_mini::new_debouncer_opt::<_, ChangesOnly>(
        config,
        move |result: DebounceEventResult| {
            let _ = event_tx.send(Control::Events(result));
        },
    )
    .map_err(|_| "Cannot start automatic updates; use Refresh")?;
    watcher
        .watcher()
        .watch(&root, notify::RecursiveMode::Recursive)
        .map_err(|_| "Cannot watch workspace; use Refresh")?;
    for (path, mode) in &registrations.metadata {
        watcher
            .watcher()
            .watch(path, *mode)
            .map_err(|_| "Cannot watch worktree metadata; use Refresh")?;
    }
    let worker_cancelled = cancelled.clone();
    let worker = thread::Builder::new()
        .name("repodeck workspace watch".into())
        .spawn(move || {
            run_watch(
                watcher,
                root,
                options,
                registrations,
                worker_cancelled,
                control_rx,
                on_change,
            )
        })
        .map_err(|_| "Cannot start automatic updates; use Refresh")?;
    Ok(WorkspaceWatch {
        cancelled,
        control: control_tx,
        worker: Some(worker),
    })
}
