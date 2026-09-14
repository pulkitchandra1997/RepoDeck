#[repr(C)]
struct Coord { x: i16, y: i16 }

#[repr(C)]
struct Key { down: i32, repeat: u16, virtual_key: u16, scan: u16, character: u16, control: u32 }
#[repr(C)]
struct Input { kind: u16, key: Key }

#[link(name = "user32")]
extern "system" { fn VkKeyScanW(character: u16) -> i16; }

#[link(name = "kernel32")]
extern "system" {
    fn FreeConsole() -> i32;
    fn AttachConsole(pid: u32) -> i32;
    fn CreateFileW(name: *const u16, access: u32, share: u32, security: *const u8, disposition: u32, flags: u32, template: isize) -> isize;
    fn CloseHandle(handle: isize) -> i32;
    fn ReadConsoleOutputCharacterW(handle: isize, buffer: *mut u16, count: u32, origin: Coord, read: *mut u32) -> i32;
    fn WriteConsoleInputW(handle: isize, input: *const Input, count: u32, written: *mut u32) -> i32;
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let pid: u32 = args[1].parse().unwrap();
    let mut buffer = vec![0u16; 16384];
    let mut read = 0;
    unsafe {
        FreeConsole();
        assert_ne!(AttachConsole(pid), 0, "Cannot attach to test console");
        if args.get(3).map(String::as_str) == Some("--input-test") {
            let name: Vec<u16> = "CONIN$\0".encode_utf16().collect();
            let handle = CreateFileW(name.as_ptr(), 0xC0000000, 3, std::ptr::null(), 3, 0, 0);
            let mut events = Vec::new();
            for character in "echo 314159265358\r".encode_utf16() {
                let virtual_key = VkKeyScanW(character) as u16 & 0xff;
                for down in [1, 0] { events.push(Input { kind: 1, key: Key { down, repeat: 1, virtual_key, scan: 0, character, control: 0 } }); }
            }
            let mut written = 0;
            let success = WriteConsoleInputW(handle, events.as_ptr(), events.len() as u32, &mut written);
            CloseHandle(handle);
            assert_ne!(success, 0, "Cannot send test input");
            assert_eq!(written as usize, events.len());
        }
        let name: Vec<u16> = "CONOUT$\0".encode_utf16().collect();
        let handle = CreateFileW(name.as_ptr(), 0xC0000000, 3, std::ptr::null(), 3, 0, 0);
        let success = ReadConsoleOutputCharacterW(handle, buffer.as_mut_ptr(), buffer.len() as u32, Coord { x: 0, y: 0 }, &mut read);
        CloseHandle(handle);
        FreeConsole();
        assert_ne!(success, 0, "Cannot read test console");
    }
    std::fs::write(&args[2], String::from_utf16_lossy(&buffer[..read as usize])).unwrap();
}
