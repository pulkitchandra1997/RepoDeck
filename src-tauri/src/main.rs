#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(windows)]
mod terminal_windows;

mod settings_ipc;

use repodeck_core::workspace::{ScanProgress, Snapshot};
use repodeck_core::{files, repository, scanner, settings::Settings};
use serde::Serialize;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{Manager, State};

struct AppState {
    settings: Arc<Mutex<Result<Settings, String>>>,
    path: PathBuf,
    scans: Mutex<HashMap<String, Arc<AtomicBool>>>,
    watch: Mutex<Option<WatchSlot>>,
}

struct WatchSlot {
    token: String,
    watcher: Option<repodeck_core::watch::WorkspaceWatch>,
}

#[tauri::command]
fn remote_target(remote: String) -> Result<String, String> {
    repodeck_core::remote_url::browser_target(&remote)
}

#[tauri::command]
async fn open_terminal(state: State<'_, AppState>, id: String, path: String) -> Result<(), String> {
    let settings = current(&state)?;
    let root = root(&settings, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let plan =
            repodeck_core::terminal::plan(&root, &path, &settings.terminal, std::env::consts::OS)?;
        #[cfg(windows)]
        let program = {
            let system = PathBuf::from(
                std::env::var_os("SystemRoot").ok_or("Windows system folder unavailable")?,
            )
            .join("System32");
            if plan.program == "powershell.exe" {
                system.join("WindowsPowerShell/v1.0/powershell.exe")
            } else {
                system.join("cmd.exe")
            }
        };
        #[cfg(not(windows))]
        let program = PathBuf::from(plan.program);
        #[cfg(windows)]
        {
            terminal_windows::launch(&program, &plan)
        }
        #[cfg(not(windows))]
        {
            let mut command = std::process::Command::new(program);
            command.args(plan.args).current_dir(plan.directory);
            let status = command
                .status()
                .map_err(|_| "Could not open Terminal".to_string())?;
            if status.success() {
                Ok(())
            } else {
                Err("Terminal could not open this folder".into())
            }
        }
    })
    .await
    .map_err(|_| "Terminal launch worker failed".to_string())?
}

#[tauri::command]
async fn open_editor(state: State<'_, AppState>, id: String, path: String) -> Result<(), String> {
    let settings = current(&state)?;
    let root = root(&settings, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let target = repodeck_core::editor::target(&root, &path)?;
        let target = repodeck_core::editor::external_target(&target);
        let editor = repodeck_core::editor::application(&settings.editor)?;
        #[cfg(target_os = "windows")]
        let editor = if editor == "code" { "Code.exe" } else { editor };
        #[cfg(target_os = "macos")]
        let editor = if editor == "code" {
            "Visual Studio Code"
        } else {
            editor
        };
        let failure =
            || "Could not launch the editor. Check Editor application in Settings.".to_string();
        #[cfg(target_os = "macos")]
        {
            open::with(target, editor).map_err(|_| failure())
        }
        #[cfg(not(target_os = "macos"))]
        {
            let prepared = open::with_command(target, editor);
            #[cfg(windows)]
            let mut command = {
                use std::os::windows::process::CommandExt;
                let mut command = std::process::Command::new(
                    repodeck_core::editor::launch_program(prepared.get_program()),
                );
                command.args(prepared.get_args()).creation_flags(0x08000000);
                command
            };
            #[cfg(not(windows))]
            let mut command = prepared;
            let mut child = command.spawn().map_err(|_| failure())?;
            // Editors may stay open; reap the child without holding the UI request open.
            std::thread::spawn(move || {
                let _ = child.wait();
            });
            Ok(())
        }
    })
    .await
    .map_err(|_| "Editor launch worker failed".to_string())?
}

#[tauri::command]
async fn open_remote(url: String) -> Result<(), String> {
    let url = repodeck_core::remote_url::validate_browser_url(&url)?;
    tauri::async_runtime::spawn_blocking(move || {
        open::that(url).map_err(|_| "Could not open the default browser".to_string())
    })
    .await
    .map_err(|_| "Browser launch worker failed".to_string())?
}

#[tauri::command]
async fn watch_workspace(
    state: State<'_, AppState>,
    id: String,
    token: String,
    on_change: tauri::ipc::Channel<repodeck_core::watch::WatchNotice>,
) -> Result<(), String> {
    if token.is_empty() || token.len() > 128 {
        return Err("Invalid watch identifier".into());
    }
    let settings = current(&state)?;
    let root = root(&settings, &id)?;
    *state.watch.lock().map_err(|_| "Watch state unavailable")? = Some(WatchSlot {
        token: token.clone(),
        watcher: None,
    });
    let watcher = tauri::async_runtime::spawn_blocking(move || {
        let options = scanner::ScanOptions {
            excluded: settings.excluded,
            max_depth: settings.max_depth,
            max_entries: settings.max_entries,
            show_hidden: settings.show_hidden,
        };
        repodeck_core::watch::start_with_options(&root, &options, move |notice| {
            let _ = on_change.send(notice);
        })
    })
    .await
    .map_err(|_| "Watch worker failed")??;
    let mut guard = state.watch.lock().map_err(|_| "Watch state unavailable")?;
    if let Some(slot) = guard.as_mut().filter(|slot| slot.token == token) {
        slot.watcher = Some(watcher);
        Ok(())
    } else {
        Err("Watch superseded".into())
    }
}

#[tauri::command]
fn stop_watch(state: State<AppState>, token: String) -> Result<(), String> {
    let mut guard = state.watch.lock().map_err(|_| "Watch state unavailable")?;
    if guard.as_ref().is_some_and(|slot| slot.token == token) {
        *guard = None;
    }
    Ok(())
}

fn current(state: &AppState) -> Result<Settings, String> {
    state
        .settings
        .lock()
        .map(|s| s.clone())
        .map_err(|_| "Settings are unavailable".to_string())?
}
fn root(settings: &Settings, id: &str) -> Result<PathBuf, String> {
    settings
        .workspaces
        .iter()
        .find(|w| w.id == id)
        .map(|w| PathBuf::from(&w.root_path))
        .ok_or("Workspace not found".into())
}
fn collect(settings: &Settings, id: &str) -> Result<Snapshot, String> {
    collect_controlled(settings, id, &AtomicBool::new(false), |_| {})
}
fn collect_controlled(
    settings: &Settings,
    id: &str,
    cancelled: &AtomicBool,
    on_progress: impl FnMut(ScanProgress),
) -> Result<Snapshot, String> {
    let root = root(settings, id)?;
    repodeck_core::workspace::collect(
        &root,
        &scanner::ScanOptions {
            max_depth: settings.max_depth,
            max_entries: settings.max_entries,
            excluded: settings.excluded.clone(),
            show_hidden: settings.show_hidden,
        },
        cancelled,
        on_progress,
    )
}
#[tauri::command]
fn get_settings(state: State<AppState>) -> Result<Settings, String> {
    let mut guard = state.settings.lock().map_err(|_| "Settings unavailable")?;
    if guard.is_err() {
        *guard = Settings::load(&state.path);
    }
    guard.clone()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Recovery {
    settings: Settings,
    backup_path: String,
}

#[tauri::command]
async fn recover_settings(state: State<'_, AppState>) -> Result<Recovery, String> {
    let store = state.settings.clone();
    let path = state.path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = store.lock().map_err(|_| "Settings unavailable")?;
        if guard.is_ok() {
            return Err("Settings are already available".into());
        }
        let backup = Settings::recover(&path)?;
        let settings = Settings::load(&path)?;
        *guard = Ok(settings.clone());
        Ok(Recovery {
            settings,
            backup_path: backup.to_string_lossy().into_owned(),
        })
    })
    .await
    .map_err(|_| "Recovery worker failed")?
}

#[tauri::command]
async fn add_workspace(state: State<'_, AppState>) -> Result<Option<Settings>, String> {
    let Some(folder) = rfd::AsyncFileDialog::new()
        .set_title("Open workspace folder")
        .pick_folder()
        .await
    else {
        return Ok(None);
    };
    let mut guard = state.settings.lock().map_err(|_| "Settings unavailable")?;
    let mut next = guard.clone()?;
    next.add_workspace(folder.path())?;
    settings_ipc::persist(&state.path, &mut guard, next).map(Some)
}
#[tauri::command]
fn remove_workspace(state: State<AppState>, id: String) -> Result<Settings, String> {
    let mut guard = state.settings.lock().map_err(|_| "Settings unavailable")?;
    let mut next = guard.clone()?;
    next.remove_workspace(&id)?;
    settings_ipc::persist(&state.path, &mut guard, next)
}
#[tauri::command]
fn save_settings(state: State<AppState>, settings: Settings) -> Result<Settings, String> {
    let mut guard = state.settings.lock().map_err(|_| "Settings unavailable")?;
    settings_ipc::save_preferences(&state.path, &mut guard, settings)
}
#[tauri::command]
async fn scan_workspace(
    state: State<'_, AppState>,
    id: String,
    on_progress: tauri::ipc::Channel<ScanProgress>,
) -> Result<Snapshot, String> {
    let settings = current(&state)?;
    let signal = Arc::new(AtomicBool::new(false));
    if let Some(previous) = state
        .scans
        .lock()
        .map_err(|_| "Scan state unavailable")?
        .insert(id.clone(), signal.clone())
    {
        previous.store(true, Ordering::Relaxed);
    }
    let worker_signal = signal.clone();
    let worker_id = id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        collect_controlled(&settings, &worker_id, &worker_signal, |progress| {
            if on_progress.send(progress).is_err() {
                worker_signal.store(true, Ordering::Relaxed);
            }
        })
    })
    .await
    .map_err(|_| "Scan worker failed".to_string())
    .and_then(|result| result);
    let mut scans = state.scans.lock().map_err(|_| "Scan state unavailable")?;
    if scans
        .get(&id)
        .is_some_and(|current| Arc::ptr_eq(current, &signal))
    {
        scans.remove(&id);
    }
    result
}
#[tauri::command]
fn cancel_scan(state: State<AppState>, id: String) -> Result<(), String> {
    if let Some(signal) = state
        .scans
        .lock()
        .map_err(|_| "Scan state unavailable")?
        .get(&id)
    {
        signal.store(true, Ordering::Relaxed);
    }
    Ok(())
}
#[tauri::command]
async fn preview_file(
    state: State<'_, AppState>,
    id: String,
    path: String,
) -> Result<files::Preview, String> {
    let root = root(&current(&state)?, &id)?;
    tauri::async_runtime::spawn_blocking(move || files::preview(&root, &path))
        .await
        .map_err(|_| "Preview worker failed")?
}
#[tauri::command]
async fn file_diff(
    state: State<'_, AppState>,
    id: String,
    repository: String,
    path: String,
    staged: bool,
) -> Result<String, String> {
    let root = root(&current(&state)?, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let repo = if repository == "." {
            root
        } else {
            files::resolve(&root, &repository)?
        };
        repository::diff(&repo, &path, staged)
    })
    .await
    .map_err(|_| "Diff worker failed")?
}
#[tauri::command]
async fn export_report(
    state: State<'_, AppState>,
    id: String,
    format: String,
) -> Result<bool, String> {
    if !matches!(format.as_str(), "json" | "markdown") {
        return Err("Unsupported format".into());
    }
    let settings = current(&state)?;
    let name = settings
        .workspaces
        .iter()
        .find(|w| w.id == id)
        .ok_or("Workspace not found")?
        .name
        .clone();
    let extension = if format == "json" { "json" } else { "md" };
    let content = tauri::async_runtime::spawn_blocking(move || {
        let snapshot = collect(&settings, &id)?;
        let mut warnings = snapshot.warnings;
        let mut repositories = Vec::new();
        for repo in snapshot.repositories {
            if let Some(status) = repo.status {
                repositories.push(status);
            }
            if let Some(error) = repo.error {
                warnings.push(format!("{}: {}", repo.relative_path, error));
            }
        }
        let scan = scanner::Scan {
            entries: snapshot.entries,
            warnings,
        };
        if format == "json" {
            repodeck_core::report::json(&name, &scan, &repositories)
        } else {
            Ok(repodeck_core::report::markdown(&name, &scan, &repositories))
        }
    })
    .await
    .map_err(|_| "Report worker failed")??;
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_file_name(format!("repodeck-report.{extension}"))
        .save_file()
        .await
    else {
        return Ok(false);
    };
    file.write(content.as_bytes())
        .await
        .map_err(|_| "Cannot save report")?;
    Ok(true)
}
#[tauri::command]
async fn git_config(
    state: State<'_, AppState>,
    id: String,
    repository: String,
) -> Result<Vec<repodeck_core::git_settings::ConfigEntry>, String> {
    let root = root(&current(&state)?, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let repo = if repository == "." {
            root
        } else {
            files::resolve(&root, &repository)?
        };
        repodeck_core::git_settings::config(&repo)
    })
    .await
    .map_err(|_| "Configuration worker failed")?
}

#[tauri::command]
async fn ignore_rule(
    state: State<'_, AppState>,
    id: String,
    repository: String,
    path: String,
) -> Result<Option<repodeck_core::git_settings::IgnoreRule>, String> {
    let root = root(&current(&state)?, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let repo = if repository == "." {
            root
        } else {
            files::resolve(&root, &repository)?
        };
        repodeck_core::git_settings::ignore_rule(&repo, &path)
    })
    .await
    .map_err(|_| "Ignore-rule worker failed")?
}

#[tauri::command]
async fn git_features(
    state: State<'_, AppState>,
    id: String,
    repository: String,
) -> Result<repodeck_core::git_settings::RepositoryFeatures, String> {
    let root = root(&current(&state)?, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let repo = if repository == "." {
            root
        } else {
            files::resolve(&root, &repository)?
        };
        repodeck_core::git_settings::features(&repo)
    })
    .await
    .map_err(|_| "Repository inventory worker failed")?
}

#[derive(Serialize)]
struct GitAvailability {
    available: bool,
    platform: &'static str,
    message: String,
}

#[tauri::command]
async fn check_git() -> Result<GitAvailability, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let platform = if cfg!(target_os = "macos") {
            "macos"
        } else {
            "windows"
        };
        match repodeck_core::git_runtime::version() {
            Ok(message) => GitAvailability {
                available: true,
                platform,
                message,
            },
            Err(message) => GitAvailability {
                available: false,
                platform,
                message,
            },
        }
    })
    .await
    .map_err(|_| "Git prerequisite check failed".into())
}

#[tauri::command]
async fn install_git() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(target_os = "macos")]
        {
            let output = repodeck_core::process::run(
                std::process::Command::new("/usr/bin/xcode-select").arg("--install"),
                std::time::Duration::from_secs(10), 8192, &AtomicBool::new(false),
            ).map_err(|_| "Apple's installer could not start")?;
            if !output.status.success() {
                return Err("Apple could not start installation. Check Software Update or the selected Xcode installation, then retry.".into());
            }
            Ok("Complete the Apple installer, then check again.".into())
        }
        #[cfg(not(target_os = "macos"))]
        {
            open::that("https://git-scm.com/install/windows").map_err(|_| "Git download page could not open")?;
            Ok("Complete Git setup, then check again.".into())
        }
    }).await.map_err(|_| "Git setup request failed".to_string())?
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let directory = match std::env::var_os("REPODECK_DATA_DIR") {
                Some(value) => {
                    let directory = PathBuf::from(value);
                    if !directory.is_absolute() {
                        return Err("REPODECK_DATA_DIR must be absolute".into());
                    }
                    directory
                }
                None => app.path().app_config_dir()?,
            };
            let path = directory.join("settings.json");
            let settings = Settings::load(Path::new(&path));
            app.manage(AppState {
                settings: Arc::new(Mutex::new(settings)),
                scans: Mutex::new(HashMap::new()),
                watch: Mutex::new(None),
                path,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_git,
            install_git,
            get_settings,
            watch_workspace,
            stop_watch,
            recover_settings,
            add_workspace,
            remove_workspace,
            save_settings,
            scan_workspace,
            remote_target,
            open_remote,
            open_editor,
            open_terminal,
            cancel_scan,
            preview_file,
            file_diff,
            export_report,
            git_config,
            ignore_rule,
            git_features
        ])
        .run(tauri::generate_context!())
        .expect("RepoDeck could not start");
}
