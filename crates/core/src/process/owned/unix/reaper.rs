use std::{
    io,
    process::Child,
    sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc::{self, SyncSender},
        OnceLock,
    },
    time::Duration,
};

const MAX_CHILDREN: usize = 64;
static RESERVED: AtomicUsize = AtomicUsize::new(0);
static REAPER: OnceLock<Result<SyncSender<(Child, Slot)>, io::Error>> = OnceLock::new();

// Admission reserves eventual reap capacity before spawn. Permanently stuck children
// consume slots and reject new work instead of accumulating threads or zombies.
#[derive(Debug)]
pub(super) struct Slot(&'static AtomicUsize);

impl Slot {
    pub(super) fn reserve() -> io::Result<Self> {
        Self::reserve_from(&RESERVED)
    }

    fn reserve_from(reserved: &'static AtomicUsize) -> io::Result<Self> {
        reserved
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
                (count < MAX_CHILDREN).then_some(count + 1)
            })
            .map_err(|_| io::Error::other("owned child capacity exhausted"))?;
        let slot = Self(reserved);
        if let Err(error) = REAPER.get_or_init(start) {
            return Err(io::Error::new(
                error.kind(),
                "cannot start owned child reaper",
            ));
        }
        Ok(slot)
    }

    pub(super) fn defer(self, child: Child) {
        // Every queued/active child owns a slot, so the bounded channel cannot be full.
        REAPER
            .get()
            .unwrap()
            .as_ref()
            .unwrap()
            .try_send((child, self))
            .expect("reserved owned child reaper capacity");
    }
}

impl Drop for Slot {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

fn start() -> io::Result<SyncSender<(Child, Slot)>> {
    let (tx, rx) = mpsc::sync_channel::<(Child, Slot)>(MAX_CHILDREN);
    std::thread::Builder::new()
        .name("repodeck child reaper".into())
        .spawn(move || {
            let mut pending: Vec<(Child, Slot)> = Vec::with_capacity(MAX_CHILDREN);
            loop {
                if let Ok(child) = rx.recv_timeout(Duration::from_millis(100)) {
                    pending.push(child);
                }
                pending.extend(rx.try_iter());
                pending.retain_mut(|(child, _)| match child.try_wait() {
                    Ok(Some(_)) => false,
                    Err(error) if error.raw_os_error() == Some(libc::ECHILD) => false,
                    _ => true,
                });
            }
        })?;
    Ok(tx)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn admission_rejects_exhaustion_and_recovers_released_slots() {
        static TEST_RESERVED: AtomicUsize = AtomicUsize::new(0);
        let mut slots: Vec<_> = (0..MAX_CHILDREN)
            .map(|_| Slot::reserve_from(&TEST_RESERVED).unwrap())
            .collect();
        assert!(Slot::reserve_from(&TEST_RESERVED).is_err());
        slots.pop();
        let replacement = Slot::reserve_from(&TEST_RESERVED).unwrap();
        assert!(Slot::reserve_from(&TEST_RESERVED).is_err());
        drop(replacement);
        drop(slots);
        assert_eq!(TEST_RESERVED.load(Ordering::Acquire), 0);
    }
}
