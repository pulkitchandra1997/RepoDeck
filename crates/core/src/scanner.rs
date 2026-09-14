use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::{fs, path::Path, time::UNIX_EPOCH};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub path: String,
    pub directory: bool,
    pub repository: bool,
    pub agent_config: bool,
    pub size: u64,
    pub modified_ms: u128,
}

#[derive(Debug, Default, Serialize)]
pub struct Scan {
    pub entries: Vec<Entry>,
    pub warnings: Vec<String>,
}

pub struct ScanOptions {
    pub max_depth: usize,
    pub excluded: Vec<String>,
    pub show_hidden: bool,
    pub max_entries: usize,
}

impl Default for ScanOptions {
    fn default() -> Self {
        Self {
            max_depth: 12,
            excluded: [
                ".git",
                "node_modules",
                "target",
                "dist",
                "build",
                ".venv",
                "venv",
            ]
            .iter()
            .map(|s| s.to_string())
            .collect(),
            show_hidden: false,
            max_entries: 50_000,
        }
    }
}

fn is_agent(name: &str) -> bool {
    matches!(
        name,
        ".agents"
            | ".claude"
            | ".codex"
            | ".cursor"
            | "AGENTS.md"
            | "CLAUDE.md"
            | "GEMINI.md"
            | ".cursorrules"
            | "copilot-instructions.md"
    )
}

pub fn scan(
    root: &Path,
    options: &ScanOptions,
    on_entry: impl FnMut(&Entry),
) -> Result<Scan, String> {
    scan_controlled(root, options, &AtomicBool::new(false), on_entry)
}

pub fn scan_controlled(
    root: &Path,
    options: &ScanOptions,
    cancelled: &AtomicBool,
    mut on_entry: impl FnMut(&Entry),
) -> Result<Scan, String> {
    if cancelled.load(Ordering::Relaxed) {
        return Err("Scan cancelled".into());
    }
    let root = root
        .canonicalize()
        .map_err(|_| "Workspace folder cannot be accessed")?;
    if !root.is_dir() {
        return Err("Select a workspace folder".into());
    }
    if options.max_entries == 0 || options.max_depth == 0 {
        return Err("Scan limits must be positive".into());
    }
    let mut result = Scan::default();
    if root.join(".git").exists() {
        let entry = Entry {
            path: ".".into(),
            directory: true,
            repository: true,
            agent_config: false,
            size: 0,
            modified_ms: 0,
        };
        on_entry(&entry);
        result.entries.push(entry);
    }
    let mut pending = vec![(root.clone(), 0, false)];
    while let Some((folder, depth, parent_agent)) = pending.pop() {
        if cancelled.load(Ordering::Relaxed) {
            return Err("Scan cancelled".into());
        }
        if depth >= options.max_depth {
            result.warnings.push(format!(
                "Depth limit reached: {}",
                folder.strip_prefix(&root).unwrap_or(&folder).display()
            ));
            continue;
        }
        let children = match fs::read_dir(&folder) {
            Ok(children) => children,
            Err(_) => {
                result.warnings.push(format!(
                    "Cannot read folder: {}",
                    folder.strip_prefix(&root).unwrap_or(&folder).display()
                ));
                continue;
            }
        };
        for child in children {
            if cancelled.load(Ordering::Relaxed) {
                return Err("Scan cancelled".into());
            }
            let child = match child {
                Ok(child) => child,
                Err(_) => {
                    result
                        .warnings
                        .push("A directory entry could not be read".into());
                    continue;
                }
            };
            let name = child.file_name().to_string_lossy().into_owned();
            let agent_config = parent_agent || is_agent(&name);
            if name == ".git"
                || options.excluded.contains(&name)
                || (!options.show_hidden && name.starts_with('.') && !agent_config)
            {
                continue;
            }
            if result.entries.len() >= options.max_entries {
                result
                    .warnings
                    .push("Entry limit reached; scan is incomplete".into());
                return Ok(result);
            }
            let path = child.path();
            let relative = path
                .strip_prefix(&root)
                .map_err(|_| "Entry is outside workspace")?
                .to_string_lossy()
                .replace('\\', "/");
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(_) => {
                    result
                        .warnings
                        .push(format!("Cannot read metadata: {relative}"));
                    continue;
                }
            };
            // Do not follow links or Windows junctions outside the selected tree.
            #[cfg(windows)]
            let link = {
                use std::os::windows::fs::MetadataExt;
                metadata.file_attributes() & 0x400 != 0
            };
            #[cfg(not(windows))]
            let link = metadata.file_type().is_symlink();
            if link {
                result
                    .warnings
                    .push(format!("Linked entry not followed: {relative}"));
            }
            let directory = metadata.is_dir();
            let entry = Entry {
                path: relative,
                directory,
                repository: directory && !link && path.join(".git").exists(),
                agent_config,
                size: if directory { 0 } else { metadata.len() },
                modified_ms: metadata
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis())
                    .unwrap_or(0),
            };
            on_entry(&entry);
            result.entries.push(entry);
            if directory && !link {
                pending.push((path, depth + 1, agent_config));
            }
        }
    }
    if cancelled.load(Ordering::Relaxed) {
        return Err("Scan cancelled".into());
    }
    Ok(result)
}
