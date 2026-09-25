# Watch Startup Cancellation

Issue #37 introduces a caller-owned startup cancellation token. This is an
integration design, not a claim that native startup cancellation is complete.

## Ownership

The hook aborts its subscription on pause, root switch, or unmount. A backend
service reserves an opaque token before launching startup. Only reservation
handshakes are serialized; a slow obsolete startup must not block a newer one.
Abort sends an exact-token stop once reservation is acknowledged. A late
acknowledgment after abort stops that reservation without starting discovery.
Callbacks and late replies remain suppressed for the obsolete subscription.

The native lifecycle helper cancels the previous reservation before replacing it.
Startup may claim a reservation once. Installation and failure cleanup compare
the cancellation token's Arc identity, not just a caller-provided string. An old
completion, failure, or stop cannot remove the newest watcher. Watcher destruction
happens outside the lifecycle lock because destruction may join a worker.

## Integration Dependency

The draft currently tests the lifecycle helper under `cfg(test)` and tests the
backend service in isolation. Neither is wired to native IPC yet. The hook passes
an optional AbortSignal, but the existing native backend does not consume it.
Therefore pause during actual native discovery is still unresolved.

Core watch ownership remains with PR #64. Integration needs a controlled startup
entry point accepting the caller's `Arc<AtomicBool>`, propagating it through
discovery and Git metadata queries, checking cancellation before registrations,
and retaining it in the resulting watcher. The existing startup API should remain
a compatibility wrapper. This branch must not duplicate PR #64's implementation.

Once that dependency is available, wire prepare/start/stop IPC through the helper
and service, then exercise actual discovery/Git cancellation with bounded native
fixtures. Helper and transport barriers alone do not prove OS watcher cleanup or
subprocess cancellation. Native Windows and macOS CI and independent review are
still required before treating the issue as resolved.
