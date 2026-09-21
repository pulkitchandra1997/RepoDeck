use repodeck_core::settings::Settings;
use std::path::Path;

pub fn persist(
    path: &Path,
    cached: &mut Result<Settings, String>,
    next: Settings,
) -> Result<Settings, String> {
    let expected = cached.as_ref().map_err(Clone::clone)?;
    next.save_if_unchanged(path, expected)?;
    *cached = Ok(next.clone());
    Ok(next)
}

pub fn save_preferences(
    path: &Path,
    cached: &mut Result<Settings, String>,
    mut next: Settings,
) -> Result<Settings, String> {
    next.workspaces = cached.as_ref().map_err(Clone::clone)?.workspaces.clone();
    persist(path, cached, next)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preference_conflict_preserves_disk_and_cached_settings() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let initial = Settings::default();
        initial.save(&path).unwrap();
        let mut cached = Ok(initial.clone());
        let mut other = initial.clone();
        other.add_workspace(dir.path()).unwrap();
        other.save_if_unchanged(&path, &initial).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        let next = Settings {
            theme: "dark".into(),
            ..initial.clone()
        };
        assert!(save_preferences(&path, &mut cached, next)
            .unwrap_err()
            .contains("changed"));
        assert_eq!(cached, Ok(initial));
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
    }

    #[test]
    fn stale_workspace_add_and_remove_preserve_the_winning_settings() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let mut initial = Settings::default();
        let workspace = initial.add_workspace(dir.path()).unwrap();
        initial.save(&path).unwrap();
        let mut other = initial.clone();
        other.repository_aliases.insert(
            dir.path().to_string_lossy().into_owned(),
            "Kept alias".into(),
        );
        other.save_if_unchanged(&path, &initial).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        let mut removed = initial.clone();
        removed.remove_workspace(&workspace.id).unwrap();
        let second = dir.path().join("second");
        std::fs::create_dir(&second).unwrap();
        let mut added = initial.clone();
        added.add_workspace(&second).unwrap();
        for next in [removed, added] {
            let mut cached = Ok(initial.clone());
            assert!(persist(&path, &mut cached, next).is_err());
            assert_eq!(cached, Ok(initial.clone()));
            assert_eq!(std::fs::read(&path).unwrap(), bytes);
        }
    }

    #[test]
    fn preferences_keep_native_workspaces_and_advance_cache_only_after_success() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let mut initial = Settings::default();
        initial.add_workspace(dir.path()).unwrap();
        initial.save(&path).unwrap();
        let mut cached = Ok(initial.clone());
        let draft = Settings {
            theme: "dark".into(),
            ..Settings::default()
        };
        let saved = save_preferences(&path, &mut cached, draft).unwrap();
        assert_eq!(saved.workspaces, initial.workspaces);
        assert_eq!(saved.theme, "dark");
        assert_eq!(cached, Ok(saved.clone()));
        assert_eq!(Settings::load(&path).unwrap(), saved);
        let invalid = Settings {
            editor: "code.cmd".into(),
            ..saved.clone()
        };
        assert!(save_preferences(&path, &mut cached, invalid).is_err());
        assert_eq!(cached, Ok(saved.clone()));
        assert_eq!(Settings::load(&path).unwrap(), saved);
    }

    #[test]
    fn unavailable_cache_cannot_be_reset_by_a_preferences_request() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, b"{broken").unwrap();
        let mut cached = Settings::load(&path);
        assert!(save_preferences(&path, &mut cached, Settings::default()).is_err());
        assert!(cached.is_err());
        assert_eq!(std::fs::read(path).unwrap(), b"{broken");
    }
}
