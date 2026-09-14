use repodeck_core::terminal;
use std::{ffi::OsString, fs};

#[test]
fn windows_launch_uses_cwd_not_interpolated_shell_commands() {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir(root.path().join("repo & $(name); test")).unwrap();
    let plan = terminal::plan(root.path(), "repo & $(name); test", "system", "windows").unwrap();
    assert_eq!(plan.program, "powershell.exe");
    assert_eq!(plan.remove_env, ["PSModulePath"]);
    assert_eq!(
        plan.args,
        ["-NoLogo", "-NoProfile", "-NoExit"].map(OsString::from)
    );
    assert!(plan.directory.ends_with("repo & $(name); test"));
    let cmd = terminal::plan(root.path(), ".", "cmd", "windows").unwrap();
    assert_eq!(cmd.program, "cmd.exe");
    assert_eq!(cmd.args, [OsString::from("/D")]);
}

#[test]
fn mac_terminal_receives_the_directory_as_one_argument() {
    let root = tempfile::tempdir().unwrap();
    let plan = terminal::plan(root.path(), ".", "system", "macos").unwrap();
    assert_eq!(plan.program, "/usr/bin/open");
    assert_eq!(
        plan.args,
        [
            OsString::from("-a"),
            OsString::from("Terminal"),
            plan.directory.clone().into_os_string()
        ]
    );
}

#[test]
fn rejects_files_escapes_and_unsupported_terminal_choices() {
    let root = tempfile::tempdir().unwrap();
    fs::write(root.path().join("file.txt"), "content").unwrap();
    for path in ["file.txt", "../outside", ".git", "/absolute"] {
        assert!(terminal::plan(root.path(), path, "system", "windows").is_err());
    }
    assert!(terminal::plan(root.path(), ".", "cmd /c evil", "windows").is_err());
    assert!(terminal::plan(root.path(), ".", "powershell", "macos").is_err());
}
