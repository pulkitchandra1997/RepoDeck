use repodeck_core::remote_url::{browser_target, validate_browser_url};

#[test]
fn maps_common_git_remotes_without_provider_restrictions() {
    for (remote, expected) in [
        (
            "https://github.com/expressjs/express.git",
            "https://github.com/expressjs/express",
        ),
        (
            "git@gitlab.com:group/sub/project.git",
            "https://gitlab.com/group/sub/project",
        ),
        (
            "ssh://git@code.example.org:22/team/app.git",
            "https://code.example.org/team/app",
        ),
        (
            "http://localhost:3000/team/app.git",
            "http://localhost:3000/team/app",
        ),
        (
            "https://user:secret@code.example.org/team/app.git?token=secret#private",
            "https://code.example.org/team/app",
        ),
    ] {
        assert_eq!(browser_target(remote).unwrap(), expected);
    }
}

#[test]
fn rejects_local_unsafe_or_ambiguous_remote_addresses() {
    for remote in [
        "",
        "/tmp/repo",
        "C:/repo",
        "file:///tmp/repo",
        "javascript:alert(1)",
        "ext::command",
        "https://example.org/\nrepo",
        "https://example.org\\repo",
        "ssh://git@example.org:2222/app",
        "git@example.org:",
    ] {
        assert!(browser_target(remote).is_err(), "accepted {remote}");
    }
}

#[test]
fn browser_launch_accepts_only_clean_http_urls() {
    assert_eq!(
        validate_browser_url("https://example.org/team/app").unwrap(),
        "https://example.org/team/app"
    );
    for address in [
        "file:///tmp/a",
        "ssh://example.org/a",
        "https://secret@example.org/a",
        "https://example.org/a?token=secret",
        "https://example.org/a#secret",
        "https://example.org/\na",
    ] {
        assert!(validate_browser_url(address).is_err());
    }
}
