use repodeck_core::editor;
use std::fs;

#[cfg(windows)]
#[test]
fn converts_safe_verbatim_paths_for_external_editors() {
    use std::path::Path;
    assert_eq!(
        editor::external_target(Path::new(r"\\?\C:\work space\package.json")),
        Path::new(r"C:\work space\package.json")
    );
    assert_eq!(
        editor::external_target(Path::new(r"\\?\C:\COM1")),
        Path::new(r"\\?\C:\COM1")
    );
}

#[cfg(windows)]
#[test]
fn removes_registry_terminators_without_changing_the_executable_path() {
    use std::ffi::{OsStr, OsString};
    assert_eq!(
        editor::launch_program(OsStr::new("C:/Program Files/Code.exe\0\0")),
        OsString::from("C:/Program Files/Code.exe")
    );
    assert_eq!(
        editor::launch_program(OsStr::new("Code.exe")),
        OsString::from("Code.exe")
    );
}

#[test]
fn resolves_workspace_repository_and_agent_file_targets() {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir(root.path().join("repo")).unwrap();
    fs::write(root.path().join("repo/AGENTS.md"), "instructions").unwrap();
    assert_eq!(
        editor::target(root.path(), ".").unwrap(),
        root.path().canonicalize().unwrap()
    );
    assert_eq!(
        editor::target(root.path(), "repo/AGENTS.md").unwrap(),
        root.path().join("repo/AGENTS.md").canonicalize().unwrap()
    );
    assert!(editor::target(root.path(), "repo").unwrap().is_dir());
    for path in [
        "../outside",
        "/absolute",
        ".git/config",
        "repo/missing",
        "repo/AGENTS.md:stream",
    ] {
        assert!(editor::target(root.path(), path).is_err());
    }
}

#[test]
fn editor_is_an_application_not_a_shell_command() {
    assert_eq!(editor::application("code").unwrap(), "code");
    assert_eq!(
        editor::application("C:/Program Files/Editor/editor.exe").unwrap(),
        "C:/Program Files/Editor/editor.exe"
    );
    for name in [
        "",
        " ",
        "editor\n--run",
        "editor\0",
        "run.CMD",
        "run.bat",
        "--help",
    ] {
        assert!(editor::application(name).is_err(), "accepted {name}");
    }
}
