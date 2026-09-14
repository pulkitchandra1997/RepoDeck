use serde::Serialize;
use std::{
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
};

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Preview {
    Text { content: String },
    Binary { size: u64 },
    TooLarge { size: u64, limit: u64 },
}

pub fn resolve(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.is_empty() || relative.contains([':', '\\', '\0']) {
        return Err("Select a relative workspace path".into());
    }
    let path = Path::new(relative);
    if path
        .components()
        .any(|part| !matches!(part, Component::Normal(_)))
        || relative
            .split('/')
            .any(|s| s.eq_ignore_ascii_case(".git") || s == ".." || s == ".")
    {
        return Err("Path is outside the permitted workspace files".into());
    }
    let root = root
        .canonicalize()
        .map_err(|_| "Workspace is unavailable")?;
    let target = root
        .join(path)
        .canonicalize()
        .map_err(|_| "File is unavailable")?;
    if !target.starts_with(&root) || target == root {
        return Err("Path resolves outside the workspace".into());
    }
    if target
        .strip_prefix(&root)
        .map_err(|_| "Invalid file path")?
        .components()
        .any(|s| s.as_os_str().to_string_lossy().eq_ignore_ascii_case(".git"))
    {
        return Err("Git internal files cannot be previewed".into());
    }
    Ok(target)
}

pub fn preview(root: &Path, relative: &str) -> Result<Preview, String> {
    const LIMIT: u64 = 1_048_576;
    let target = resolve(root, relative)?;
    let file = fs::File::open(target).map_err(|_| "Cannot open file")?;
    let metadata = file.metadata().map_err(|_| "Cannot read file metadata")?;
    if !metadata.is_file() {
        return Err("Select a regular file".into());
    }
    if metadata.len() > LIMIT {
        return Ok(Preview::TooLarge {
            size: metadata.len(),
            limit: LIMIT,
        });
    }
    let mut bytes = Vec::new();
    file.take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read file")?;
    let size = bytes.len() as u64;
    if size > LIMIT {
        return Ok(Preview::TooLarge { size, limit: LIMIT });
    }
    if bytes.contains(&0) {
        return Ok(Preview::Binary { size });
    }
    match String::from_utf8(bytes) {
        Ok(content) => Ok(Preview::Text { content }),
        Err(_) => Ok(Preview::Binary { size }),
    }
}
