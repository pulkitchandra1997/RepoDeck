use std::{ffi::OsString, os::windows::ffi::OsStrExt, path::Path};
use windows_sys::Win32::{
    Foundation::CloseHandle,
    System::Threading::{
        CreateProcessW, CREATE_NEW_CONSOLE, CREATE_UNICODE_ENVIRONMENT, PROCESS_INFORMATION,
        STARTUPINFOW,
    },
};

pub fn launch(program: &Path, plan: &repodeck_core::terminal::Launch) -> Result<(), String> {
    let wide = |value: &std::ffi::OsStr| value.encode_wide().chain(Some(0)).collect::<Vec<_>>();
    let program_wide = wide(program.as_os_str());
    let directory = wide(plan.directory.as_os_str());
    // Only the fixed preset flags enter this command line; the directory is a separate API field.
    let mut line = OsString::from("\"");
    line.push(program);
    line.push("\"");
    for arg in &plan.args {
        line.push(" ");
        line.push(arg);
    }
    let mut line = wide(&line);
    let mut vars: Vec<_> = std::env::vars_os()
        .filter(|(key, _)| {
            !plan
                .remove_env
                .iter()
                .any(|removed| key.to_string_lossy().eq_ignore_ascii_case(removed))
        })
        .collect();
    vars.sort_by_key(|(key, _)| key.to_string_lossy().to_uppercase());
    let mut environment = Vec::new();
    for (key, value) in vars {
        let mut entry = key;
        entry.push("=");
        entry.push(value);
        environment.extend(wide(&entry));
    }
    environment.push(0);
    let startup = STARTUPINFOW {
        cb: std::mem::size_of::<STARTUPINFOW>() as u32,
        ..unsafe { std::mem::zeroed() }
    };
    let mut process: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };
    // No inherited handles or STARTF_USESTDHANDLES: the new console owns stdin/stdout.
    let success = unsafe {
        CreateProcessW(
            program_wide.as_ptr(),
            line.as_mut_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            0,
            CREATE_NEW_CONSOLE | CREATE_UNICODE_ENVIRONMENT,
            environment.as_ptr().cast(),
            directory.as_ptr(),
            &startup,
            &mut process,
        )
    };
    if success == 0 {
        return Err("Could not open the terminal. Check Terminal in Settings.".into());
    }
    unsafe {
        CloseHandle(process.hThread);
        CloseHandle(process.hProcess);
    }
    Ok(())
}
