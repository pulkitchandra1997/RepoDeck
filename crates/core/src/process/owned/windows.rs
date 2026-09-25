use std::{
    ffi::c_void,
    io,
    mem::{size_of, zeroed},
    os::windows::{io::AsRawHandle, process::CommandExt},
    process::{Child, Command, ExitStatus},
    ptr::{null, null_mut},
    time::Instant,
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

use super::{poll_until, CLEANUP_TIMEOUT};

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
    cleanup_deadline: Option<Instant>,
}

impl OwnedChild {
    pub(super) fn spawn(command: &mut Command) -> io::Result<Self> {
        Self::spawn_with_setup(command, |child, job| {
            if unsafe { AssignProcessToJobObject(job.0, child.as_raw_handle() as HANDLE) } == 0 {
                return Err(io::Error::last_os_error());
            }
            resume_process_threads(child.id())
        })
    }

    fn spawn_with_setup(
        command: &mut Command,
        setup: impl FnOnce(&Child, &OwnedHandle) -> io::Result<()>,
    ) -> io::Result<Self> {
        let job = create_job()?;
        // Assignment happens before user code runs, so descendants cannot win the job race.
        command.creation_flags(CREATE_NO_WINDOW | CREATE_SUSPENDED);
        let child = command.spawn()?;
        // Install the same bounded guard before assignment/resumption can fail.
        let owned = Self {
            child,
            job,
            parent_status: None,
            finished: false,
            cleanup_deadline: None,
        };
        setup(&owned.child, &owned.job)?;
        Ok(owned)
    }

    pub(super) fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        if self.finished {
            return Ok(self.parent_status);
        }
        if self.parent_status.is_none() {
            self.parent_status = self.child.try_wait()?;
        }
        if self.parent_status.is_some() {
            self.terminate()?;
            return Ok(self.parent_status);
        }
        Ok(None)
    }

    pub(super) fn terminate(&mut self) -> io::Result<()> {
        if self.finished {
            return Ok(());
        }
        let deadline = *self
            .cleanup_deadline
            .get_or_insert_with(|| Instant::now() + CLEANUP_TIMEOUT);
        unsafe {
            TerminateJobObject(self.job.0, 1);
        }
        // The exact process handle also covers failure before job assignment.
        let _ = self.child.kill();
        poll_until(deadline, || {
            if self.parent_status.is_none() {
                self.parent_status = self.child.try_wait()?;
            }
            Ok((self.parent_status.is_some() && self.active_processes()? == 0).then_some(()))
        })?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::{os::windows::io::AsHandle, time::Duration};
    use windows_sys::Win32::{Foundation::WAIT_OBJECT_0, System::Threading::WaitForSingleObject};

    #[test]
    fn setup_failures_before_and_after_assignment_clean_exact_suspended_child() {
        for assigned in [false, true] {
            let mut handle = None;
            let start = Instant::now();
            let result = OwnedChild::spawn_with_setup(
                &mut Command::new(std::env::current_exe().unwrap()),
                |child, job| {
                    handle = Some(child.as_handle().try_clone_to_owned().unwrap());
                    if assigned {
                        assert_ne!(
                            unsafe {
                                AssignProcessToJobObject(job.0, child.as_raw_handle() as HANDLE)
                            },
                            0
                        );
                    }
                    Err(io::Error::other("injected setup failure"))
                },
            );
            assert!(result.is_err());
            assert!(start.elapsed() < Duration::from_secs(3));
            assert_eq!(
                unsafe { WaitForSingleObject(handle.unwrap().as_raw_handle() as HANDLE, 1000) },
                WAIT_OBJECT_0
            );
        }
    }

    #[test]
    fn expired_cleanup_budget_is_reused_by_drop() {
        let mut child = OwnedChild::spawn_with_setup(
            &mut Command::new(std::env::current_exe().unwrap()),
            |_, _| Ok(()),
        )
        .unwrap();
        let handle = child.child.as_handle().try_clone_to_owned().unwrap();
        let deadline = Instant::now();
        child.cleanup_deadline = Some(deadline);
        let start = Instant::now();
        let _ = child.terminate();
        assert_eq!(child.cleanup_deadline, Some(deadline));
        drop(child);
        assert!(start.elapsed() < Duration::from_millis(500));
        assert_eq!(
            unsafe { WaitForSingleObject(handle.as_raw_handle() as HANDLE, 1000) },
            WAIT_OBJECT_0
        );
    }
}
