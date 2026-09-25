// Trusted test executable, selected only in the isolated test subprocess's PATH.
fn main() {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let root = std::path::PathBuf::from(std::env::var_os("REPODECK_WATCH_STALL_CHILD").unwrap());
    let option = std::env::var_os("REPODECK_TEST_STALL_OPTION").unwrap();
    if root.join("stall").exists() && args.contains(&option) {
        std::fs::write(root.join("started"), "started").unwrap();
        std::thread::sleep(std::time::Duration::from_secs(5));
    }
    let status = std::process::Command::new(std::env::var_os("REPODECK_TEST_REAL_GIT").unwrap())
        .args(args).status().unwrap();
    std::process::exit(status.code().unwrap_or(1));
}
