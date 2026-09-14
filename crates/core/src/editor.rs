use std::path::{Path, PathBuf};

pub fn external_target(path: &Path) -> PathBuf {
    dunce::simplified(path).to_path_buf()
}

#[cfg(windows)]
pub fn launch_program(program: &std::ffi::OsStr) -> std::ffi::OsString {
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    let mut units: Vec<u16> = program.encode_wide().collect();
    // open 5.4.4 may retain an extra terminator from Windows App Paths values.
    while units.last() == Some(&0) {
        units.pop();
    }
    std::ffi::OsString::from_wide(&units)
}

pub fn target(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative == "." {
        let root = root
            .canonicalize()
            .map_err(|_| "Workspace is unavailable")?;
        if !root.is_dir() {
            return Err("Select a workspace folder".into());
        }
        return Ok(root);
    }
    crate::files::resolve(root, relative)
}

pub fn application(value: &str) -> Result<&str, String> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 8192
        || value.starts_with('-')
        || value.chars().any(char::is_control)
        || value.to_ascii_lowercase().ends_with(".cmd")
        || value.to_ascii_lowercase().ends_with(".bat")
    {
        return Err("Choose an editor application or executable, not a shell script".into());
    }
    Ok(value)
}
