use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

#[derive(Clone)]
pub struct Startup {
    cancelled: Arc<AtomicBool>,
}

impl Startup {
    pub fn cancellation(&self) -> Arc<AtomicBool> {
        self.cancelled.clone()
    }
}

struct Slot<W> {
    token: String,
    startup: Startup,
    claimed: bool,
    watcher: Option<W>,
}

impl<W> Drop for Slot<W> {
    fn drop(&mut self) {
        self.startup.cancelled.store(true, Ordering::Release);
    }
}

pub struct WatchLifecycle<W> {
    current: Mutex<Option<Slot<W>>>,
}

impl<W> Default for WatchLifecycle<W> {
    fn default() -> Self {
        Self {
            current: Mutex::new(None),
        }
    }
}

impl<W> WatchLifecycle<W> {
    pub fn reserve(&self, token: String) -> Result<(), String> {
        if token.is_empty() || token.len() > 128 {
            return Err("Invalid watch identifier".into());
        }
        let previous = {
            let mut current = self.current.lock().map_err(|_| "Watch state unavailable")?;
            if let Some(previous) = current.as_ref() {
                previous.startup.cancelled.store(true, Ordering::Release);
            }
            current.replace(Slot {
                token,
                startup: Startup {
                    cancelled: Arc::new(AtomicBool::new(false)),
                },
                claimed: false,
                watcher: None,
            })
        };
        // Watch destruction can join a worker; never hold the lifecycle lock during it.
        drop(previous);
        Ok(())
    }

    pub fn claim(&self, token: &str) -> Result<Startup, String> {
        let mut current = self.current.lock().map_err(|_| "Watch state unavailable")?;
        let slot = current
            .as_mut()
            .filter(|slot| slot.token == token && !slot.claimed)
            .ok_or("Watch superseded")?;
        slot.claimed = true;
        Ok(slot.startup.clone())
    }

    pub fn install(&self, startup: &Startup, watcher: W) -> Result<(), String> {
        let mut current = self.current.lock().map_err(|_| "Watch state unavailable")?;
        let slot = current
            .as_mut()
            .filter(|slot| {
                Arc::ptr_eq(&slot.startup.cancelled, &startup.cancelled)
                    && slot.claimed
                    && slot.watcher.is_none()
                    && !startup.cancelled.load(Ordering::Acquire)
            })
            .ok_or("Watch superseded")?;
        slot.watcher = Some(watcher);
        Ok(())
    }

    pub fn fail(&self, startup: &Startup) -> Result<(), String> {
        let previous = {
            let mut current = self.current.lock().map_err(|_| "Watch state unavailable")?;
            if current
                .as_ref()
                .is_some_and(|slot| Arc::ptr_eq(&slot.startup.cancelled, &startup.cancelled))
            {
                startup.cancelled.store(true, Ordering::Release);
                current.take()
            } else {
                None
            }
        };
        drop(previous);
        Ok(())
    }

    pub fn stop(&self, token: &str) -> Result<(), String> {
        let previous = {
            let mut current = self.current.lock().map_err(|_| "Watch state unavailable")?;
            if current.as_ref().is_some_and(|slot| slot.token == token) {
                current
                    .as_ref()
                    .unwrap()
                    .startup
                    .cancelled
                    .store(true, Ordering::Release);
                current.take()
            } else {
                None
            }
        };
        drop(previous);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{atomic::AtomicUsize, Barrier};

    struct Watch(Arc<AtomicUsize>);
    impl Drop for Watch {
        fn drop(&mut self) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }

    #[test]
    fn pause_at_startup_barrier_prevents_obsolete_discovery_and_registration() {
        let lifecycle = Arc::new(WatchLifecycle::<Watch>::default());
        lifecycle.reserve("old".into()).unwrap();
        let startup = lifecycle.claim("old").unwrap();
        let ready = Arc::new(Barrier::new(2));
        let resume = Arc::new(Barrier::new(2));
        let calls = Arc::new(AtomicUsize::new(0));
        let worker = {
            let (ready, resume, calls) = (ready.clone(), resume.clone(), calls.clone());
            std::thread::spawn(move || {
                ready.wait();
                resume.wait();
                if !startup.cancellation().load(Ordering::Acquire) {
                    calls.fetch_add(1, Ordering::SeqCst);
                }
            })
        };
        ready.wait();
        lifecycle.stop("old").unwrap();
        resume.wait();
        worker.join().unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        assert!(lifecycle.claim("old").is_err());
    }

    #[test]
    fn newest_watch_survives_old_completion_failure_and_stop() {
        let lifecycle = Arc::new(WatchLifecycle::<Watch>::default());
        lifecycle.reserve("old".into()).unwrap();
        let old = lifecycle.claim("old").unwrap();
        let ready = Arc::new(Barrier::new(2));
        let resume = Arc::new(Barrier::new(2));
        let old_drops = Arc::new(AtomicUsize::new(0));
        let worker = {
            let (lifecycle, old, ready, resume, drops) = (
                lifecycle.clone(),
                old.clone(),
                ready.clone(),
                resume.clone(),
                old_drops.clone(),
            );
            std::thread::spawn(move || {
                ready.wait();
                resume.wait();
                assert!(lifecycle.install(&old, Watch(drops)).is_err());
                lifecycle.fail(&old).unwrap();
                lifecycle.stop("old").unwrap();
            })
        };
        ready.wait();
        lifecycle.reserve("new".into()).unwrap();
        let new = lifecycle.claim("new").unwrap();
        assert!(old.cancellation().load(Ordering::Acquire));
        let new_drops = Arc::new(AtomicUsize::new(0));
        lifecycle.install(&new, Watch(new_drops.clone())).unwrap();
        resume.wait();
        worker.join().unwrap();
        assert_eq!(old_drops.load(Ordering::SeqCst), 1);
        assert_eq!(new_drops.load(Ordering::SeqCst), 0);
        assert!(!new.cancellation().load(Ordering::Acquire));
        lifecycle.stop("new").unwrap();
        assert_eq!(new_drops.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn reservation_must_be_current_and_claimed_only_once() {
        let lifecycle = WatchLifecycle::<()>::default();
        assert!(lifecycle.reserve(String::new()).is_err());
        assert!(lifecycle.reserve("x".repeat(129)).is_err());
        lifecycle.reserve("one".into()).unwrap();
        let one = lifecycle.claim("one").unwrap();
        assert!(lifecycle.claim("one").is_err());
        lifecycle.fail(&one).unwrap();
        assert!(one.cancellation().load(Ordering::Acquire));
        assert!(lifecycle.claim("one").is_err());
        lifecycle.reserve("two".into()).unwrap();
        let two = lifecycle.claim("two").unwrap();
        drop(lifecycle);
        assert!(two.cancellation().load(Ordering::Acquire));
    }
}
