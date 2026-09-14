use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub root_path: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub schema_version: u32,
    pub workspaces: Vec<Workspace>,
    pub theme: String,
    pub max_depth: usize,
    pub max_entries: usize,
    pub excluded: Vec<String>,
    pub show_hidden: bool,
    pub editor: String,
    #[serde(default = "default_terminal")]
    pub terminal: String,
    #[serde(default = "enabled")]
    pub auto_refresh: bool,
    #[serde(default)]
    pub onboarding_completed: bool,
    #[serde(default)]
    pub repository_aliases: BTreeMap<String, String>,
}

fn enabled() -> bool {
    true
}

fn default_terminal() -> String {
    "system".into()
}

impl Default for Settings {
    fn default() -> Self {
        let scan = crate::scanner::ScanOptions::default();
        Self {
            schema_version: 1,
            workspaces: vec![],
            theme: "system".into(),
            max_depth: scan.max_depth,
            max_entries: scan.max_entries,
            excluded: scan.excluded,
            show_hidden: false,
            editor: "code".into(),
            terminal: default_terminal(),
            auto_refresh: true,
            onboarding_completed: false,
            repository_aliases: BTreeMap::new(),
        }
    }
}

impl Settings {
    pub fn recover(path: &Path) -> Result<PathBuf, String> {
        if Self::load(path).is_ok() {
            return Err("Settings can be loaded; retry opening RepoDeck".into());
        }
        let metadata = fs::symlink_metadata(path).map_err(|_| "Cannot inspect settings file")?;
        if !metadata.is_file() || metadata.len() > 16 * 1_048_576 {
            return Err("Recovery requires a regular settings file no larger than 16 MiB".into());
        }
        let mut bytes = Vec::new();
        fs::File::open(path)
            .map_err(|_| "Cannot open settings for backup")?
            .take(16 * 1_048_576 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Cannot read settings for backup")?;
        if bytes.len() > 16 * 1_048_576 {
            return Err("Settings exceed the recovery limit".into());
        }
        let backup = path.with_file_name(format!("settings.backup-{}.json", uuid::Uuid::new_v4()));
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&backup)
            .map_err(|_| "Cannot create settings backup; original file preserved")?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "Cannot finish settings backup; original file preserved")?;
        let mut latest = Vec::new();
        fs::File::open(path)
            .map_err(|_| "Cannot recheck settings; original file preserved")?
            .take(16 * 1_048_576 + 1)
            .read_to_end(&mut latest)
            .map_err(|_| "Cannot recheck settings; original file preserved")?;
        if latest != bytes {
            return Err("Settings changed during recovery; retry loading them".into());
        }
        Self::default().save(path)?;
        Ok(backup)
    }

    fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 {
            return Err("Unsupported settings version; upgrade RepoDeck".into());
        }
        if !matches!(self.theme.as_str(), "system" | "light" | "dark")
            || !(1..=128).contains(&self.max_depth)
            || !(1..=1_000_000).contains(&self.max_entries)
        {
            return Err("Invalid theme or scan limits".into());
        }
        if self.repository_aliases.len() > 10_000
            || self.repository_aliases.iter().any(|(path, alias)| {
                !Path::new(path).is_absolute()
                    || path.len() > 32_768
                    || alias.trim().is_empty()
                    || alias.chars().count() > 80
                    || alias.chars().any(char::is_control)
            })
        {
            return Err("Repository aliases require an absolute path and a name of 1-80 characters without control characters".into());
        }
        let mut ids = HashSet::new();
        let mut paths = HashSet::new();
        for workspace in &self.workspaces {
            if uuid::Uuid::parse_str(&workspace.id).is_err()
                || !ids.insert(&workspace.id)
                || !paths.insert(&workspace.root_path)
                || !Path::new(&workspace.root_path).is_absolute()
            {
                return Err("Invalid workspace identity or path".into());
            }
        }
        Ok(())
    }

    pub fn load(path: &Path) -> Result<Self, String> {
        let file = match fs::File::open(path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self::default())
            }
            Err(_) => return Err("Cannot open settings file".into()),
        };
        let mut bytes = Vec::new();
        file.take(1_048_577)
            .read_to_end(&mut bytes)
            .map_err(|_| "Cannot read settings")?;
        if bytes.len() > 1_048_576 {
            return Err("Settings file exceeds 1 MiB".into());
        }
        let settings: Self = serde_json::from_slice(&bytes)
            .map_err(|_| "Settings are invalid; original file was preserved")?;
        settings.validate()?;
        Ok(settings)
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        self.validate()?;
        // Load old launcher values for repair, but do not persist new invalid choices.
        crate::editor::application(&self.editor)?;
        if !matches!(self.terminal.as_str(), "system" | "powershell" | "cmd") {
            return Err("Choose a supported terminal preset".into());
        }
        let bytes = serde_json::to_vec_pretty(self).map_err(|_| "Cannot serialize settings")?;
        if bytes.len() > 1_048_576 {
            return Err("Settings file exceeds 1 MiB".into());
        }
        let parent = path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        fs::create_dir_all(parent).map_err(|_| "Cannot create settings folder")?;
        let mut temporary = tempfile::NamedTempFile::new_in(parent)
            .map_err(|_| "Cannot create settings temporary file")?;
        temporary
            .write_all(&bytes)
            .map_err(|_| "Cannot write settings")?;
        temporary
            .as_file()
            .sync_all()
            .map_err(|_| "Cannot flush settings")?;
        temporary
            .persist(path)
            .map_err(|_| "Cannot replace settings file")?;
        Ok(())
    }

    pub fn add_workspace(&mut self, path: &Path) -> Result<Workspace, String> {
        let root = path
            .canonicalize()
            .map_err(|_| "Workspace folder cannot be accessed")?;
        if !root.is_dir() {
            return Err("Select a folder".into());
        }
        let root_path = root
            .to_str()
            .ok_or("Workspace path is not UTF-8")?
            .to_owned();
        if let Some(existing) = self.workspaces.iter().find(|w| w.root_path == root_path) {
            return Ok(existing.clone());
        }
        let workspace = Workspace {
            id: uuid::Uuid::new_v4().to_string(),
            name: root
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| root_path.clone()),
            root_path,
        };
        self.workspaces.push(workspace.clone());
        Ok(workspace)
    }

    pub fn remove_workspace(&mut self, id: &str) -> Result<(), String> {
        let position = self
            .workspaces
            .iter()
            .position(|w| w.id == id)
            .ok_or("Workspace not found")?;
        self.workspaces.remove(position);
        Ok(())
    }
}
