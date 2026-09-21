use std::{
    ffi::c_void,
    io,
    mem::{size_of, zeroed},
    os::windows::{io::AsRawHandle, process::CommandExt},
    process::{Child, Command, ExitStatus},
    ptr::{null, null_mut},
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE},
    System::{
        Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
        },
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectBasicAccountingInformation,
            JobObjectExtendedLimitInformation, QueryInformationJobObject, SetInformationJobObject,
            TerminateJobObject, JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        },
        Threading::{
            OpenThread, ResumeThread, CREATE_NO_WINDOW, CREATE_SUSPENDED, THREAD_SUSPEND_RESUME,
        },
    },
};

const CLEANUP_TIMEOUT: Duration = Duration::from_secs(2);

struct OwnedHandle(HANDLE);

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        if !self.0.is_null() && self.0 != INVALID_HANDLE_VALUE {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

pub(super) struct OwnedChild {
    child: Child,
    job: OwnedHandle,
    parent_status: Option<ExitStatus>,
    finished: bool,
}

impl OwnedChild {
    pub(super) fn spawn(command: &mut Command) -> io::Result<Self> {
        let job = create_job()?;
        // Assignment happens before user code runs, so descendants cannot win the job race.
        command.creation_flags(CREATE_NO_WINDOW | CREATE_SUSPENDED);
        let mut child = command.spawn()?;
        let process = child.as_raw_handle() as HANDLE;
        if unsafe { AssignProcessToJobObject(job.0, process) } == 0 {
            let error = io::Error::last_os_error();
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        if let Err(error) = resume_process_threads(child.id()) {
            unsafe {
                TerminateJobObject(job.0, 1);
            }
            let _ = child.wait();
            return Err(error);
        }
        Ok(Self {
            child,
            job,
            parent_status: None,
            finished: false,
        })
    }

    pub(super) fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        if self.finished {
            return Ok(self.parent_status);
        }
        if self.parent_status.is_none() {
            self.parent_status = self.child.try_wait()?;
        }
        if self.parent_status.is_some() && self.active_processes()? == 0 {
            self.finished = true;
            return Ok(self.parent_status);
        }
        Ok(None)
    }

    pub(super) fn terminate(&mut self) -> io::Result<()> {
        if self.finished {
            return Ok(());
        }
        if self.active_processes()? > 0 && unsafe { TerminateJobObject(self.job.0, 1) } == 0 {
            return Err(io::Error::last_os_error());
        }
        if self.parent_status.is_none() {
            self.parent_status = Some(self.child.wait()?);
        }
        let deadline = Instant::now() + CLEANUP_TIMEOUT;
        while self.active_processes()? > 0 {
            if Instant::now() >= deadline {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "owned job did not terminate",
                ));
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        self.finished = true;
        Ok(())
    }

    fn active_processes(&self) -> io::Result<u32> {
        let mut info = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
        if unsafe {
            QueryInformationJobObject(
                self.job.0,
                JobObjectBasicAccountingInformation,
                &mut info as *mut _ as *mut c_void,
                size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                null_mut(),
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(info.ActiveProcesses)
    }
}

impl Drop for OwnedChild {
    fn drop(&mut self) {
        let _ = self.terminate();
    }
}

fn create_job() -> io::Result<OwnedHandle> {
    let job = OwnedHandle(unsafe { CreateJobObjectW(null(), null()) });
    if job.0.is_null() {
        return Err(io::Error::last_os_error());
    }
    let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if unsafe {
        SetInformationJobObject(
            job.0,
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const c_void,
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    Ok(job)
}

fn resume_process_threads(process_id: u32) -> io::Result<()> {
    // std::process exposes the process handle but not its primary thread handle.
    // A newly suspended process has not had an opportunity to create other threads.
    let snapshot = OwnedHandle(unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) });
    if snapshot.0 == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    let mut entry: THREADENTRY32 = unsafe { zeroed() };
    entry.dwSize = size_of::<THREADENTRY32>() as u32;
    let mut found = false;
    let mut has_entry = unsafe { Thread32First(snapshot.0, &mut entry) } != 0;
    while has_entry {
        if entry.th32OwnerProcessID == process_id {
            let thread =
                OwnedHandle(unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID) });
            if thread.0.is_null() {
                return Err(io::Error::last_os_error());
            }
            if unsafe { ResumeThread(thread.0) } == u32::MAX {
                return Err(io::Error::last_os_error());
            }
            found = true;
        }
        has_entry = unsafe { Thread32Next(snapshot.0, &mut entry) } != 0;
    }
    if !found {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "suspended child thread was not found",
        ));
    }
    Ok(())
}
