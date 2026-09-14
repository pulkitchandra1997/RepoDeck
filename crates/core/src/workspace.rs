use crate::{repository, scanner};
use serde::Serialize;
use std::{
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoResult {
    pub relative_path: String,
    pub status: Option<repository::Repository>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Snapshot {
    pub entries: Vec<scanner::Entry>,
    pub warnings: Vec<String>,
    pub repositories: Vec<RepoResult>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub phase: &'static str,
    pub entries: Vec<scanner::Entry>,
    pub repository: Option<RepoResult>,
    pub entry_count: usize,
    pub repository_count: usize,
    pub inspected_count: usize,
}

pub fn collect(
    root: &Path,
    options: &scanner::ScanOptions,
    cancelled: &AtomicBool,
    mut on_progress: impl FnMut(ScanProgress),
) -> Result<Snapshot, String> {
    let mut entry_count = 0;
    let mut repository_count = 0;
    let mut pending = Vec::new();
    let mut last_sent = Instant::now();
    on_progress(ScanProgress {
        phase: "discovery",
        entries: vec![],
        repository: None,
        entry_count: 0,
        repository_count: 0,
        inspected_count: 0,
    });
    let scan = scanner::scan_controlled(root, options, cancelled, |entry| {
        entry_count += 1;
        repository_count += usize::from(entry.repository);
        pending.push(entry.clone());
        if pending.len() >= 128 || last_sent.elapsed() >= Duration::from_millis(100) {
            on_progress(ScanProgress {
                phase: "discovery",
                entries: std::mem::take(&mut pending),
                repository: None,
                entry_count,
                repository_count,
                inspected_count: 0,
            });
            last_sent = Instant::now();
        }
    })?;
    on_progress(ScanProgress {
        phase: "repositories",
        entries: pending,
        repository: None,
        entry_count,
        repository_count,
        inspected_count: 0,
    });
    let mut repositories = Vec::new();
    for entry in scan.entries.iter().filter(|entry| entry.repository) {
        if cancelled.load(Ordering::Relaxed) {
            return Err("Scan cancelled".into());
        }
        let result = match repository::inspect_controlled(&root.join(&entry.path), cancelled) {
            Ok(status) => RepoResult {
                relative_path: entry.path.clone(),
                status: Some(status),
                error: None,
            },
            Err(error) => RepoResult {
                relative_path: entry.path.clone(),
                status: None,
                error: Some(error),
            },
        };
        if cancelled.load(Ordering::Relaxed) {
            return Err("Scan cancelled".into());
        }
        on_progress(ScanProgress {
            phase: "repositories",
            entries: vec![],
            repository: Some(result.clone()),
            entry_count,
            repository_count,
            inspected_count: repositories.len() + 1,
        });
        repositories.push(result);
    }
    if cancelled.load(Ordering::Relaxed) {
        return Err("Scan cancelled".into());
    }
    Ok(Snapshot {
        entries: scan.entries,
        warnings: scan.warnings,
        repositories,
    })
}
