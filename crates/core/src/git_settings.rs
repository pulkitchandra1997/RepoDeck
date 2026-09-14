use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize)]
pub struct ConfigEntry {
    pub key: String,
    pub value: String,
    pub hidden: bool,
}
#[derive(Debug, Serialize)]
pub struct IgnoreRule {
    pub source: String,
    pub line: u64,
    pub pattern: String,
    pub path: String,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryFeatures {
    pub hooks: Vec<String>,
    pub lfs_configured: bool,
    pub lfs_attributes: Vec<String>,
    pub warnings: Vec<String>,
}

pub fn features(root: &Path) -> Result<RepositoryFeatures, String> {
    let mut result = RepositoryFeatures {
        lfs_configured: config(root)?
            .iter()
            .any(|entry| entry.key.starts_with("filter.lfs.")),
        ..Default::default()
    };
    let hooks = crate::repository::run_output(root, &["rev-parse", "--git-path", "hooks"])?;
    if !hooks.status.success() {
        return Err("Cannot locate repository hooks".into());
    }
    let hooks = String::from_utf8(hooks.stdout).map_err(|_| "Hook path is not UTF-8")?;
    let hooks = root.join(hooks.trim_end());
    match std::fs::read_dir(hooks) {
        Ok(entries) => {
            for entry in entries {
                match entry {
                    Ok(entry) => {
                        let name = entry.file_name().to_string_lossy().into_owned();
                        match entry.file_type() {
                            Ok(kind) if kind.is_file() && !name.ends_with(".sample") => {
                                result.hooks.push(name)
                            }
                            Ok(_) => {}
                            Err(_) => result.warnings.push("Cannot read hook metadata".into()),
                        }
                    }
                    Err(_) => result.warnings.push("Cannot read hook entry".into()),
                }
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => result.warnings.push("Cannot read hooks directory".into()),
    }
    let attributes = crate::repository::run_output(
        root,
        &[
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
            "--",
            ".gitattributes",
            ":(glob)**/.gitattributes",
        ],
    )?;
    if !attributes.status.success() {
        return Err("Cannot find Git attributes".into());
    }
    let attributes =
        String::from_utf8(attributes.stdout).map_err(|_| "Attribute path is not UTF-8")?;
    for path in attributes.split_terminator('\0') {
        match crate::files::preview(root, path) {
            Ok(crate::files::Preview::Text { content }) => {
                if content
                    .lines()
                    .filter(|line| !line.trim_start().starts_with('#'))
                    .any(|line| line.split_whitespace().any(|word| word == "filter=lfs"))
                {
                    result.lfs_attributes.push(path.into());
                }
            }
            _ => result
                .warnings
                .push(format!("Cannot inspect attributes: {path}")),
        }
    }
    result.hooks.sort();
    result.lfs_attributes.sort();
    result.lfs_attributes.dedup();
    Ok(result)
}
pub fn config(root: &Path) -> Result<Vec<ConfigEntry>, String> {
    let output = crate::repository::run_output(root, &["config", "--null", "--list"])?;
    if !output.status.success() {
        return Err("Cannot read Git configuration".into());
    }
    let text = String::from_utf8(output.stdout).map_err(|_| "Git configuration is not UTF-8")?;
    let mut entries = Vec::new();
    for record in text.split_terminator('\0') {
        let (key, value) = record.split_once('\n').unwrap_or((record, "true"));
        let visible = matches!(
            key,
            "user.name"
                | "user.email"
                | "core.autocrlf"
                | "core.filemode"
                | "core.ignorecase"
                | "init.defaultbranch"
                | "pull.rebase"
                | "fetch.prune"
        );
        entries.push(ConfigEntry {
            key: if key.contains("://") || key.contains('@') {
                "[URL-scoped setting]".into()
            } else {
                key.into()
            },
            value: if visible {
                value.into()
            } else {
                "[hidden]".into()
            },
            hidden: !visible,
        });
    }
    Ok(entries)
}
pub fn ignore_rule(root: &Path, path: &str) -> Result<Option<IgnoreRule>, String> {
    if path.is_empty()
        || path.contains(['\0', ':', '\\'])
        || Path::new(path)
            .components()
            .any(|p| !matches!(p, std::path::Component::Normal(_)))
    {
        return Err("Select a relative repository path".into());
    }
    let mut input = path.as_bytes().to_vec();
    input.push(0);
    let output = crate::repository::run_output_input(
        root,
        &["check-ignore", "--verbose", "-z", "--stdin"],
        &input,
    )?;
    if output.status.code() == Some(1) {
        return Ok(None);
    }
    if !output.status.success() {
        return Err("Cannot inspect ignore rule".into());
    }
    let text = String::from_utf8(output.stdout).map_err(|_| "Ignore output is not UTF-8")?;
    let parts: Vec<_> = text.split_terminator('\0').collect();
    if parts.len() != 4 {
        return Err("Invalid ignore-rule response".into());
    }
    // A negated pattern describes an included path, not an ignored one.
    if parts[2].starts_with('!') {
        return Ok(None);
    }
    Ok(Some(IgnoreRule {
        source: parts[0].into(),
        line: parts[1].parse().map_err(|_| "Invalid ignore-rule line")?,
        pattern: parts[2].into(),
        path: parts[3].into(),
    }))
}
