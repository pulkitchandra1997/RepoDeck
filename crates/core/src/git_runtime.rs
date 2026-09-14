use std::{path::PathBuf, process::Command, sync::atomic::AtomicBool, time::Duration};

pub fn candidates() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(value) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&value).filter(|p| p.is_absolute()) {
            let candidate = directory.join(if cfg!(windows) { "git.exe" } else { "git" });
            // Apple's shim can trigger installation. Probe real tool locations instead.
            if cfg!(target_os = "macos") && candidate == std::path::Path::new("/usr/bin/git") {
                continue;
            }
            paths.push(candidate);
        }
    }
    #[cfg(windows)]
    {
        for key in ["ProgramW6432", "ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(root) = std::env::var_os(key) {
                paths.push(PathBuf::from(root).join("Git/cmd/git.exe"));
            }
        }
        if let Some(root) = std::env::var_os("LOCALAPPDATA") {
            paths.push(PathBuf::from(root).join("Programs/Git/cmd/git.exe"));
        }
    }
    #[cfg(target_os = "macos")]
    {
        paths.extend(
            [
                "/opt/homebrew/bin/git",
                "/usr/local/bin/git",
                "/Library/Developer/CommandLineTools/usr/bin/git",
                "/Applications/Xcode.app/Contents/Developer/usr/bin/git",
            ]
            .map(PathBuf::from),
        );
    }
    paths
}

pub fn executable() -> Option<PathBuf> {
    find_in(candidates())
}

fn find_in(paths: Vec<PathBuf>) -> Option<PathBuf> {
    paths.into_iter().find(|p| p.is_absolute() && p.is_file())
}

pub fn version() -> Result<String, String> {
    let executable = executable().ok_or("Git was not found. Install Git, then check again.")?;
    let output = crate::process::run(
        Command::new(executable).arg("--version"),
        Duration::from_secs(5),
        8192,
        &AtomicBool::new(false),
    )
    .map_err(|_| "Git could not run. Repair its installation, then check again.")?;
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !output.status.success() || !text.starts_with("git version ") {
        return Err("Git did not return a valid version. Repair its installation.".into());
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn discovery_uses_only_absolute_candidates() {
        assert!(candidates().iter().all(|p| p.is_absolute()));
    }
    #[test]
    fn apple_installation_shim_is_not_probed() {
        if cfg!(target_os = "macos") {
            assert!(!candidates().contains(&PathBuf::from("/usr/bin/git")));
        }
    }
    #[test]
    fn missing_paths_and_directories_do_not_hide_a_fallback_executable() {
        let root = tempfile::tempdir().unwrap();
        let fallback = root.path().join("git.exe");
        std::fs::write(&fallback, b"fixture, not executed").unwrap();
        assert_eq!(
            find_in(vec![
                PathBuf::from("git.exe"),
                root.path().join("missing"),
                root.path().to_path_buf(),
                fallback.clone()
            ]),
            Some(fallback)
        );
        assert_eq!(
            find_in(vec![PathBuf::from("git.exe"), root.path().join("missing")]),
            None
        );
    }
    #[test]
    fn installed_git_returns_a_real_version() {
        assert!(version().unwrap().starts_with("git version "));
    }
}
