use repodeck_core::settings::Settings;
use std::fs;

#[test]
fn repository_aliases_are_local_validated_and_survive_restart() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    let repo = dir.path().join("project");
    fs::create_dir(&repo).unwrap();
    let mut old = serde_json::to_value(Settings::default()).unwrap();
    old.as_object_mut().unwrap().remove("repositoryAliases");
    fs::write(&path, serde_json::to_vec(&old).unwrap()).unwrap();
    let mut settings = Settings::load(&path).unwrap();
    assert!(settings.repository_aliases.is_empty());
    settings
        .repository_aliases
        .insert(repo.to_string_lossy().into(), "Payments API".into());
    settings.save(&path).unwrap();
    assert_eq!(
        Settings::load(&path).unwrap().repository_aliases,
        settings.repository_aliases
    );
    assert_eq!(fs::read_dir(&repo).unwrap().count(), 0);
    settings
        .repository_aliases
        .insert(repo.to_string_lossy().into(), "bad\nname".into());
    assert!(settings.save(&path).is_err());
    assert_eq!(
        Settings::load(&path)
            .unwrap()
            .repository_aliases
            .values()
            .next()
            .unwrap(),
        "Payments API"
    );
}

#[test]
fn onboarding_defaults_to_not_seen_and_completion_persists() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    let mut old = serde_json::to_value(Settings::default()).unwrap();
    old.as_object_mut().unwrap().remove("onboardingCompleted");
    fs::write(&path, serde_json::to_vec(&old).unwrap()).unwrap();
    let mut settings = Settings::load(&path).unwrap();
    assert!(!settings.onboarding_completed);
    settings.onboarding_completed = true;
    settings.save(&path).unwrap();
    assert!(Settings::load(&path).unwrap().onboarding_completed);
}

#[test]
fn terminal_defaults_for_old_settings_and_survives_restart() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    let mut old = serde_json::to_value(Settings::default()).unwrap();
    old.as_object_mut().unwrap().remove("terminal");
    fs::write(&path, serde_json::to_vec(&old).unwrap()).unwrap();
    let mut settings = Settings::load(&path).unwrap();
    assert_eq!(settings.terminal, "system");
    settings.terminal = "cmd".into();
    settings.save(&path).unwrap();
    assert_eq!(Settings::load(&path).unwrap().terminal, "cmd");
}

#[test]
fn restart_restores_preferences_and_stable_workspace_identity() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state/settings.json");
    let mut settings = Settings::load(&path).unwrap();
    let workspace = settings.add_workspace(dir.path()).unwrap();
    assert!(uuid::Uuid::parse_str(&workspace.id).is_ok());
    settings.theme = "dark".into();
    settings.max_depth = 6;
    settings.save(&path).unwrap();
    assert_eq!(Settings::load(&path).unwrap(), settings);
    settings.theme = "light".into();
    settings.save(&path).unwrap();
    assert_eq!(Settings::load(&path).unwrap().theme, "light");
}

#[test]
fn automatic_refresh_preference_persists_and_old_settings_default_to_enabled() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    let mut old = serde_json::to_value(Settings::default()).unwrap();
    old.as_object_mut().unwrap().remove("autoRefresh");
    fs::write(&path, serde_json::to_vec(&old).unwrap()).unwrap();
    let mut settings = Settings::load(&path).unwrap();
    assert!(settings.auto_refresh);
    settings.auto_refresh = false;
    settings.save(&path).unwrap();
    assert!(!Settings::load(&path).unwrap().auto_refresh);
}

#[test]
fn canonical_paths_prevent_duplicates_and_removal_preserves_files() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("keep.txt");
    fs::write(&file, "keep").unwrap();
    let mut settings = Settings::default();
    let first = settings.add_workspace(dir.path()).unwrap();
    let second = settings.add_workspace(&dir.path().join(".")).unwrap();
    assert_eq!(first.id, second.id);
    assert_eq!(settings.workspaces.len(), 1);
    assert!(settings.add_workspace(&file).is_err());
    settings.remove_workspace(&first.id).unwrap();
    assert!(settings.workspaces.is_empty());
    assert_eq!(fs::read_to_string(file).unwrap(), "keep");
}

#[test]
fn corrupt_or_future_settings_are_reported_and_preserved() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    for source in ["{corrupt", "{\"schemaVersion\":999}"] {
        fs::write(&path, source).unwrap();
        assert!(Settings::load(&path).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), source);
    }
}

#[test]
fn invalid_preferences_cannot_replace_valid_settings() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    let valid = Settings::default();
    valid.save(&path).unwrap();
    let mut invalid = valid.clone();
    invalid.max_entries = 0;
    assert!(invalid.save(&path).is_err());
    invalid = valid.clone();
    invalid.theme = "unexpected".into();
    assert!(invalid.save(&path).is_err());
    assert_eq!(Settings::load(&path).unwrap(), valid);
}

#[test]
fn invalid_launcher_preferences_are_rejected_before_replacing_saved_settings() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    let valid = Settings::default();
    valid.save(&path).unwrap();
    let original = fs::read(&path).unwrap();
    for editor in [
        "",
        "  ",
        "code.cmd",
        "editor.BAT",
        "-option",
        "editor\ncommand",
    ] {
        let mut invalid = valid.clone();
        invalid.editor = editor.into();
        assert!(
            invalid.save(&path).is_err(),
            "Accepted invalid editor {editor:?}"
        );
        assert_eq!(fs::read(&path).unwrap(), original);
    }
    for terminal in ["", "bash", "powershell.exe", "system\n", "unknown"] {
        let mut invalid = valid.clone();
        invalid.terminal = terminal.into();
        assert!(
            invalid.save(&path).is_err(),
            "Accepted invalid terminal {terminal:?}"
        );
        assert_eq!(fs::read(&path).unwrap(), original);
    }
}

#[test]
fn legacy_launcher_preferences_can_load_for_repair_without_a_reset() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    let mut legacy = Settings::default();
    legacy.add_workspace(dir.path()).unwrap();
    legacy.editor = "code.cmd".into();
    legacy.terminal = "old-terminal".into();
    fs::write(&path, serde_json::to_vec(&legacy).unwrap()).unwrap();
    let mut loaded = Settings::load(&path).unwrap();
    assert_eq!(loaded.workspaces, legacy.workspaces);
    assert!(loaded.save(&path).is_err());
    loaded.editor = "code".into();
    loaded.terminal = "system".into();
    loaded.save(&path).unwrap();
    assert_eq!(Settings::load(&path).unwrap().workspaces, legacy.workspaces);
}

#[test]
fn unavailable_workspace_is_retained_after_restart() {
    let dir = tempfile::tempdir().unwrap();
    let workspace_dir = dir.path().join("project");
    fs::create_dir(&workspace_dir).unwrap();
    let path = dir.path().join("settings.json");
    let mut settings = Settings::default();
    let added = settings.add_workspace(&workspace_dir).unwrap();
    settings.save(&path).unwrap();
    fs::rename(workspace_dir, dir.path().join("renamed")).unwrap();
    let restored = Settings::load(&path).unwrap();
    assert_eq!(restored.workspaces.len(), 1);
    assert_eq!(restored.workspaces[0].id, added.id);
}

#[test]
fn recovery_preserves_corrupt_and_future_settings_before_resetting() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    let mut future = serde_json::to_value(Settings::default()).unwrap();
    future["schemaVersion"] = 999.into();
    for source in [
        b"{broken\xFF".to_vec(),
        serde_json::to_vec(&future).unwrap(),
    ] {
        fs::write(&path, &source).unwrap();
        let backup = Settings::recover(&path).unwrap();
        assert_eq!(fs::read(&backup).unwrap(), source);
        assert_eq!(backup.parent(), path.parent());
        assert_ne!(backup, path);
        assert_eq!(Settings::load(&path).unwrap(), Settings::default());
    }
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 3);
}

#[test]
fn recovery_refuses_valid_missing_or_non_file_settings() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    assert!(Settings::recover(&path).is_err());
    let settings = Settings {
        theme: "dark".into(),
        ..Settings::default()
    };
    settings.save(&path).unwrap();
    assert!(Settings::recover(&path).is_err());
    assert_eq!(Settings::load(&path).unwrap(), settings);
    assert!(Settings::recover(dir.path()).is_err());
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
}

#[test]
fn oversized_recovery_is_rejected_without_replacing_the_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    fs::File::create(&path)
        .unwrap()
        .set_len(16 * 1_048_576 + 1)
        .unwrap();
    assert!(Settings::recover(&path).unwrap_err().contains("16 MiB"));
    assert_eq!(fs::metadata(&path).unwrap().len(), 16 * 1_048_576 + 1);
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
}
