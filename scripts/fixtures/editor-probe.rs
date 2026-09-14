fn main() {
    let output = std::env::var_os("REPODECK_EDITOR_PROBE").expect("Missing probe output path");
    let args: Vec<String> = std::env::args().skip(1).collect();
    std::fs::write(output, args.join("\0")).expect("Cannot write editor arguments");
}
