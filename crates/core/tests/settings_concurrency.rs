use repodeck_core::settings::Settings;
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    path::Path,
    process::{Child, Command, Stdio},
    sync::mpsc::{self, Receiver},
    time::Duration,
};

struct Peer {
    child: Child,
    messages: Receiver<String>,
}

impl Peer {
    fn start(directory: &Path, role: &str) -> Self {
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "settings_peer", "--ignored", "--nocapture"])
            .env("REPODECK_SETTINGS_FIXTURE", directory)
            .env("REPODECK_SETTINGS_ROLE", role)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        let stdout = child.stdout.take().unwrap();
        let (tx, messages) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                if tx.send(line.unwrap()).is_err() {
                    break;
                }
            }
        });
        let peer = Self { child, messages };
        assert_eq!(peer.message(), "READY");
        peer
    }

    fn message(&self) -> String {
        loop {
            let line = self.messages.recv_timeout(Duration::from_secs(15)).unwrap();
            if line == "READY" || line.starts_with("RESULT:") {
                return line;
            }
        }
    }

    fn go(&mut self) {
        writeln!(self.child.stdin.as_mut().unwrap(), "go").unwrap();
    }

    fn finish(&mut self) -> String {
        let message = self.message();
        assert!(self.child.wait().unwrap().success());
        message
    }
}

impl Drop for Peer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[test]
#[ignore = "Coordinated subprocess fixture; only uses the supplied temporary directory"]
fn settings_peer() {
    let directory =
        std::path::PathBuf::from(std::env::var_os("REPODECK_SETTINGS_FIXTURE").unwrap());
    let path = directory.join("settings.json");
    let role = std::env::var("REPODECK_SETTINGS_ROLE").unwrap();
    let lock = if role == "lock" {
        let file = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(directory.join("settings.json.lock"))
            .unwrap();
        file.try_lock().unwrap();
        Some(file)
    } else {
        None
    };
    let expected = if role == "recover" || role == "lock" {
        None
    } else {
        Some(Settings::load(&path).unwrap())
    };
    println!("\nREADY");
    std::io::stdout().flush().unwrap();
    let mut command = String::new();
    std::io::stdin().read_line(&mut command).unwrap();
    assert_eq!(command.trim(), "go");
    let result = if role == "lock" {
        drop(lock);
        Ok(())
    } else if role == "recover" {
        Settings::recover(&path).map(|_| ())
    } else {
        let expected = expected.unwrap();
        let mut next = expected.clone();
        if role == "workspace" {
            next.add_workspace(&directory.join("project")).unwrap();
            next.repository_aliases.insert(
                directory.join("project").to_string_lossy().into_owned(),
                "Kept alias".into(),
            );
        } else {
            next.theme = "light".into();
        }
        next.save_if_unchanged(&path, &expected)
    };
    println!("RESULT:{}", result.err().unwrap_or_else(|| "ok".into()));
}

fn fixture() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("project")).unwrap();
    let settings = Settings {
        theme: "dark".into(),
        ..Settings::default()
    };
    settings.save(&dir.path().join("settings.json")).unwrap();
    dir
}

#[test]
fn stale_preferences_cannot_discard_another_writers_workspace_and_alias() {
    let dir = fixture();
    let path = dir.path().join("settings.json");
    let expected = Settings::load(&path).unwrap();
    let mut winner = expected.clone();
    winner.add_workspace(&dir.path().join("project")).unwrap();
    winner.repository_aliases.insert(
        dir.path().to_string_lossy().into_owned(),
        "Kept alias".into(),
    );
    winner.save_if_unchanged(&path, &expected).unwrap();
    let bytes = fs::read(&path).unwrap();
    let mut stale = expected.clone();
    stale.theme = "light".into();
    assert!(stale.save_if_unchanged(&path, &expected).is_err());
    assert_eq!(fs::read(&path).unwrap(), bytes);
    let refreshed = Settings::load(&path).unwrap();
    let mut next = refreshed.clone();
    next.theme = "light".into();
    next.save_if_unchanged(&path, &refreshed).unwrap();
    assert_eq!(Settings::load(&path).unwrap().workspaces, winner.workspaces);
}

#[test]
fn coordinated_processes_reject_the_stale_writer() {
    let dir = fixture();
    let mut first = Peer::start(dir.path(), "workspace");
    let mut second = Peer::start(dir.path(), "theme");
    first.go();
    assert_eq!(first.finish(), "RESULT:ok");
    let path = dir.path().join("settings.json");
    let bytes = fs::read(&path).unwrap();
    second.go();
    assert!(second.finish().contains("changed"));
    assert_eq!(fs::read(&path).unwrap(), bytes);
    let persisted = Settings::load(&path).unwrap();
    assert_eq!(persisted.workspaces.len(), 1);
    assert_eq!(
        persisted.repository_aliases.values().next().unwrap(),
        "Kept alias"
    );
    assert_eq!(persisted.theme, "dark");
}

#[test]
fn simultaneous_processes_never_acknowledge_two_writes_from_one_baseline() {
    let dir = fixture();
    let mut first = Peer::start(dir.path(), "workspace");
    let mut second = Peer::start(dir.path(), "theme");
    first.go();
    second.go();
    let results = [first.finish(), second.finish()];
    assert_eq!(
        results
            .iter()
            .filter(|result| *result == "RESULT:ok")
            .count(),
        1
    );
    let persisted = Settings::load(&dir.path().join("settings.json")).unwrap();
    if results[0] == "RESULT:ok" {
        assert_eq!(persisted.workspaces.len(), 1);
        assert_eq!(persisted.theme, "dark");
    } else {
        assert!(persisted.workspaces.is_empty());
        assert_eq!(persisted.theme, "light");
    }
}

#[test]
fn recovery_wins_before_stale_process_save_without_losing_backup() {
    let dir = fixture();
    let path = dir.path().join("settings.json");
    let mut stale = Peer::start(dir.path(), "theme");
    fs::write(&path, b"{corrupt\xff").unwrap();
    let mut recovery = Peer::start(dir.path(), "recover");
    recovery.go();
    assert_eq!(recovery.finish(), "RESULT:ok");
    stale.go();
    assert!(stale.finish().contains("changed"));
    assert_eq!(Settings::load(&path).unwrap(), Settings::default());
    let backup = fs::read_dir(dir.path())
        .unwrap()
        .flatten()
        .find(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("settings.backup-")
        })
        .unwrap();
    assert_eq!(fs::read(backup.path()).unwrap(), b"{corrupt\xff");
}

#[test]
fn recovery_refuses_to_reset_another_processes_committed_settings() {
    let dir = fixture();
    let path = dir.path().join("settings.json");
    let mut writer = Peer::start(dir.path(), "workspace");
    let mut recovery = Peer::start(dir.path(), "recover");
    writer.go();
    assert_eq!(writer.finish(), "RESULT:ok");
    let bytes = fs::read(&path).unwrap();
    recovery.go();
    assert_ne!(recovery.finish(), "RESULT:ok");
    assert_eq!(fs::read(&path).unwrap(), bytes);
}

#[test]
fn simultaneous_recoveries_preserve_one_backup_and_one_reset() {
    let dir = fixture();
    let path = dir.path().join("settings.json");
    fs::write(&path, b"{broken").unwrap();
    let mut first = Peer::start(dir.path(), "recover");
    let mut second = Peer::start(dir.path(), "recover");
    first.go();
    second.go();
    let results = [first.finish(), second.finish()];
    assert_eq!(
        results
            .iter()
            .filter(|result| *result == "RESULT:ok")
            .count(),
        1
    );
    assert_eq!(Settings::load(&path).unwrap(), Settings::default());
    let backups: Vec<_> = fs::read_dir(dir.path())
        .unwrap()
        .map(Result::unwrap)
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("settings.backup-")
        })
        .collect();
    assert_eq!(backups.len(), 1);
    assert_eq!(fs::read(backups[0].path()).unwrap(), b"{broken");
}

#[cfg(unix)]
#[test]
fn parent_symlink_aliases_contend_and_settings_file_symlinks_are_rejected() {
    let dir = fixture();
    let aliases = tempfile::tempdir().unwrap();
    let alias = aliases.path().join("profile");
    std::os::unix::fs::symlink(dir.path(), &alias).unwrap();
    let mut holder = Peer::start(dir.path(), "lock");
    let path = alias.join("settings.json");
    let expected = Settings::load(&path).unwrap();
    assert!(expected
        .save_if_unchanged(&path, &expected)
        .unwrap_err()
        .contains("lock"));
    holder.go();
    assert_eq!(holder.finish(), "RESULT:ok");
    let file_alias = aliases.path().join("settings.json");
    std::os::unix::fs::symlink(&path, &file_alias).unwrap();
    let bytes = fs::read(&path).unwrap();
    assert!(expected.save_if_unchanged(&file_alias, &expected).is_err());
    assert!(expected.save(&file_alias).is_err());
    assert_eq!(fs::read(&path).unwrap(), bytes);
}

#[test]
fn save_and_recovery_share_a_lock_released_on_normal_and_forced_exit() {
    for forced in [false, true] {
        let dir = fixture();
        let path = dir.path().join("settings.json");
        let mut holder = Peer::start(dir.path(), "lock");
        let expected = Settings::load(&path).unwrap();
        let mut next = expected.clone();
        next.theme = "light".into();
        // Both canonical and original spelling must contend on the same sidecar.
        assert!(next
            .save_if_unchanged(&path.canonicalize().unwrap(), &expected)
            .unwrap_err()
            .contains("lock"));
        assert!(next.save(&path).unwrap_err().contains("lock"));
        let corrupt = b"{broken\xff";
        fs::write(&path, corrupt).unwrap();
        assert!(Settings::recover(&path).unwrap_err().contains("lock"));
        assert_eq!(fs::read(&path).unwrap(), corrupt);
        assert!(!fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .starts_with("settings.backup-")));
        if forced {
            holder.child.kill().unwrap();
            holder.child.wait().unwrap();
        } else {
            holder.go();
            assert_eq!(holder.finish(), "RESULT:ok");
        }
        let backup = Settings::recover(&path).unwrap();
        assert_eq!(fs::read(backup).unwrap(), corrupt);
        let expected = Settings::load(&path).unwrap();
        next.save_if_unchanged(&path, &expected).unwrap();
        assert_eq!(Settings::load(&path).unwrap().theme, "light");
    }
}

#[test]
fn failed_guarded_saves_preserve_disk_and_release_the_lock() {
    let dir = fixture();
    let path = dir.path().join("settings.json");
    let expected = Settings::load(&path).unwrap();
    let bytes = fs::read(&path).unwrap();
    let mut invalid = expected.clone();
    invalid.theme = "invalid".into();
    assert!(invalid.save_if_unchanged(&path, &expected).is_err());
    assert_eq!(fs::read(&path).unwrap(), bytes);
    let mut valid = expected.clone();
    valid.theme = "light".into();
    valid.save_if_unchanged(&path, &expected).unwrap();
    for changed in [
        b"{corrupt".as_slice(),
        b"{\"schemaVersion\":999}".as_slice(),
    ] {
        fs::write(&path, changed).unwrap();
        assert!(valid.save_if_unchanged(&path, &expected).is_err());
        assert_eq!(fs::read(&path).unwrap(), changed);
    }
}

#[test]
fn concurrent_first_run_cannot_replace_the_first_saved_workspace() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("new-profile/settings.json");
    let expected = Settings::load(&path).unwrap();
    let mut winner = expected.clone();
    winner.add_workspace(dir.path()).unwrap();
    winner.save_if_unchanged(&path, &expected).unwrap();
    let bytes = fs::read(&path).unwrap();
    assert!(expected.save_if_unchanged(&path, &expected).is_err());
    assert_eq!(fs::read(&path).unwrap(), bytes);
}
