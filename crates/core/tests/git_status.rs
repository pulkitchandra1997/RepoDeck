use repodeck_core::git::parse_status;

#[test]
fn preserves_spaces_newlines_and_unicode_in_paths() {
    let changes =
        parse_status(" M folder/hello world.txt\0?? line\nbreak.txt\0?? 日本語.txt\0".as_bytes())
            .unwrap();
    assert_eq!(changes.len(), 3);
    assert_eq!(changes[0].path, "folder/hello world.txt");
    assert_eq!(changes[0].worktree, 'M');
    assert_eq!(changes[1].path, "line\nbreak.txt");
    assert_eq!(changes[2].path, "日本語.txt");
}

#[test]
fn consumes_rename_source_without_creating_a_second_change() {
    let changes = parse_status(b"R  new name.txt\0old name.txt\0?? next.txt\0").unwrap();
    assert_eq!(changes.len(), 2);
    assert_eq!(changes[0].original_path.as_deref(), Some("old name.txt"));
    assert_eq!(changes[0].path, "new name.txt");
}

#[test]
fn retains_staged_conflicted_deleted_and_ignored_status() {
    let changes =
        parse_status(b"MM both.txt\0UU conflict.txt\0 D deleted.txt\0!! ignored/\0").unwrap();
    assert_eq!(changes.len(), 4);
    assert_eq!((changes[0].index, changes[0].worktree), ('M', 'M'));
    assert_eq!(changes[1].index, 'U');
    assert_eq!(changes[2].worktree, 'D');
    assert_eq!(changes[3].index, '!');
}

#[test]
fn rejects_truncated_records() {
    assert!(parse_status(b" M no-terminator").is_err());
    assert!(parse_status(b"R  destination\0").is_err());
    assert!(parse_status(b"x\0").is_err());
}
