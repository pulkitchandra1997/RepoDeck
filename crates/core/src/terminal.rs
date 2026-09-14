use std::{
    ffi::OsString,
    path::{Path, PathBuf},
};

#[derive(Debug)]
pub struct Launch {
    pub program: &'static str,
    pub args: Vec<OsString>,
    pub directory: PathBuf,
    pub remove_env: Vec<&'static str>,
}

pub fn plan(root: &Path, relative: &str, choice: &str, platform: &str) -> Result<Launch, String> {
    let directory = crate::editor::target(root, relative)?;
    if !directory.is_dir() {
        return Err("Select a folder for the terminal".into());
    }
    let directory = crate::editor::external_target(&directory);
    let (program, args) = match (platform, choice) {
        ("windows", "system" | "powershell") => (
            "powershell.exe",
            vec!["-NoLogo".into(), "-NoProfile".into(), "-NoExit".into()],
        ),
        ("windows", "cmd") => ("cmd.exe", vec!["/D".into()]),
        ("macos", "system") => (
            "/usr/bin/open",
            vec![
                "-a".into(),
                "Terminal".into(),
                directory.clone().into_os_string(),
            ],
        ),
        _ => return Err("This terminal choice is not supported on this operating system".into()),
    };
    Ok(Launch {
        program,
        args,
        directory,
        remove_env: if program == "powershell.exe" {
            vec!["PSModulePath"]
        } else {
            vec![]
        },
    })
}
