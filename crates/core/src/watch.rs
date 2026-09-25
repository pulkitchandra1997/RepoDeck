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
        mpsc::{self, Receiver, SyncSender},
        Arc, Mutex,
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
    control: SyncSender<()>,
    worker: Option<JoinHandle<()>>,
}

impl Drop for WorkspaceWatch {
    fn drop(&mut self) {
        self.cancelled.store(true, Ordering::Release);
        let _ = self.control.try_send(());
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

type Registration = (PathBuf, notify::RecursiveMode);

#[derive(Clone)]
struct RegistrationSet {
    metadata: Vec<Registration>,
    pointers: Vec<PathBuf>,
}

#[derive(Default)]
struct PendingEvents {
    pointer_dirty: bool,
    relevant: bool,
    error: bool,
}

struct EventInbox {
    registrations: RegistrationSet,
    pending: PendingEvents,
}

impl EventInbox {
    fn collect(&mut self, result: DebounceEventResult, root: &Path, excluded: &[String]) {
        match result {
            Ok(events) => {
                self.pending.pointer_dirty |=
                    touches_pointer(&events, &self.registrations.pointers);
                self.pending.relevant |=
                    relevant_event(&events, &self.registrations, root, excluded);
            }
            Err(_) => self.pending.error = true,
        }
    }
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

fn metadata_path(root: &Path, option: &str, cancelled: &AtomicBool) -> Result<PathBuf, String> {
    let output = repository::run_output_controlled(
        root,
        &["rev-parse", "--path-format=absolute", option],
        &[],
        cancelled,
    )?;
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
    let scan = scanner::scan_controlled(root, options, cancelled, |_| {})?;
    // An omitted checkout is not evidence its metadata watch should be removed.
    // Linked entries are deliberately excluded, not an incomplete inventory.
    if scan
        .warnings
        .iter()
        .any(|warning| !warning.starts_with("Linked entry not followed:"))
    {
        return Err("Workspace inventory is incomplete; use Refresh".into());
    }
    for entry in scan.entries.iter().filter(|entry| entry.repository) {
        if cancelled.load(Ordering::Acquire) {
            return Err("Watch cancelled".into());
        }
        let checkout = root.join(&entry.path);
        let pointer = checkout.join(".git");
        if !pointer.is_file() {
            continue;
        }
        pointers.push(pointer);
        let git_dir = metadata_path(&checkout, "--absolute-git-dir", cancelled)?;
        if cancelled.load(Ordering::Acquire) {
            return Err("Watch cancelled".into());
        }
        let common_dir = metadata_path(&checkout, "--git-common-dir", cancelled)?;
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
    inbox: Arc<Mutex<EventInbox>>,
    cancelled: Arc<AtomicBool>,
    control: Receiver<()>,
    mut on_change: impl FnMut(WatchNotice),
) {
    let mut registrations = inbox.lock().unwrap().registrations.clone();
    while control.recv().is_ok() {
        if cancelled.load(Ordering::Acquire) {
            break;
        }
        let pending = std::mem::take(&mut inbox.lock().unwrap().pending);
        if pending.error {
            report_failure(&cancelled, &mut on_change);
        }
        if pending.pointer_dirty {
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
            inbox.lock().unwrap().registrations = next.clone();
            registrations = next;
        }
        if !cancelled.load(Ordering::Acquire) && pending.relevant && !pending.error {
            on_change(WatchNotice { error: None });
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
    // At most one wakeup and three sticky flags, independent of event volume.
    let (control_tx, control_rx) = mpsc::sync_channel(1);
    let event_tx = control_tx.clone();
    let inbox = Arc::new(Mutex::new(EventInbox {
        registrations: registrations.clone(),
        pending: PendingEvents::default(),
    }));
    let event_inbox = inbox.clone();
    let event_root = root.clone();
    let event_excluded = options.excluded.clone();
    let mut watcher = notify_debouncer_mini::new_debouncer_opt::<_, ChangesOnly>(
        config,
        move |result: DebounceEventResult| {
            event_inbox
                .lock()
                .unwrap()
                .collect(result, &event_root, &event_excluded);
            let _ = event_tx.try_send(());
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
                inbox,
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

#[cfg(test)]
mod tests {
    use super::*;
    use notify_debouncer_mini::{DebouncedEvent, DebouncedEventKind};

    #[test]
    fn coalescing_keeps_pointer_changes_and_errors_across_event_floods() {
        let root = tempfile::tempdir().unwrap();
        let pointer = root.path().join("checkout/.git");
        let mut inbox = EventInbox {
            registrations: RegistrationSet {
                metadata: vec![],
                pointers: vec![pointer.clone()],
            },
            pending: PendingEvents::default(),
        };
        inbox.collect(
            Ok(vec![DebouncedEvent::new(pointer, DebouncedEventKind::Any)]),
            root.path(),
            &[],
        );
        inbox.collect(
            Err(notify::Error::generic("fixture backend failure")),
            root.path(),
            &[],
        );
        for _ in 0..10_000 {
            inbox.collect(
                Ok(vec![DebouncedEvent::new(
                    root.path().join("node_modules/output"),
                    DebouncedEventKind::Any,
                )]),
                root.path(),
                &["node_modules".into()],
            );
        }
        let pending = std::mem::take(&mut inbox.pending);
        assert!(pending.pointer_dirty);
        assert!(pending.error);
        assert!(pending.relevant);
        assert!(!inbox.pending.pointer_dirty && !inbox.pending.error && !inbox.pending.relevant);
    }

    #[test]
    fn coalesced_success_does_not_clear_a_backend_error() {
        let root = tempfile::tempdir().unwrap();
        let watcher = notify_debouncer_mini::new_debouncer_opt::<_, ChangesOnly>(
            Config::default(),
            |_: DebounceEventResult| {},
        )
        .unwrap();
        let inbox = Arc::new(Mutex::new(EventInbox {
            registrations: RegistrationSet {
                metadata: vec![],
                pointers: vec![],
            },
            pending: PendingEvents {
                pointer_dirty: false,
                relevant: true,
                error: true,
            },
        }));
        let (tx, rx) = mpsc::sync_channel(1);
        tx.send(()).unwrap();
        drop(tx);
        let mut notices = Vec::new();
        run_watch(
            watcher,
            root.path().to_path_buf(),
            ScanOptions::default(),
            inbox,
            Arc::new(AtomicBool::new(false)),
            rx,
            |notice| notices.push(notice),
        );
        assert_eq!(notices.len(), 1);
        assert!(notices[0].error.as_ref().unwrap().contains("Refresh"));
    }
}
