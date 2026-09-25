# Hosted Preview 3 Process Smoke

Draft issue #19 evidence harness. Orchestrator review is required before its first
manual dispatch. No native run has been performed during implementation.

`hosted-preview3-smoke.yml` has only `workflow_dispatch`, no caller, push, PR or
schedule trigger. Its fixed matrix uses GitHub-hosted `macos-15` (ARM) and
`macos-15-intel`. The script refuses other platforms, runner environments, events,
repositories and architecture combinations. These environment checks are an
accident guard, not cryptographic proof of a disposable machine; never reproduce
them on a user's Mac or a self-hosted runner.

The harness downloads only the published preview.3 assets with fixed SHA-256
values, uses the existing native DMG validator, mounts read-only, copies the bundle
with ditto to a unique runner-temp directory, ejects, checks the copied signature,
and directly launches `Contents/MacOS/repodeck-desktop`. It requires a GUI bootstrap
domain first. GUI availability on these runners is untested; absence is recorded
as a failure, not a passing smoke. A bootstrap domain alone does not prove a
visible or responsive window.

The direct child PID can be attributed to this harness. It observes survival for
15 seconds and then sends SIGTERM only through that ChildProcess handle, followed
by SIGKILL after five seconds if needed, with another five-second bound. It never
uses process-name termination or LaunchServices, which could return an existing
instance. Exit code, signal, spawn error and bounded stdout/stderr are retained.
An empty `REPODECK_DATA_DIR` is unique to the run. No app is copied to /Applications.

Cleanup detaches only the requested private mountpoint and removes only the
directory created by this run, after eject and owned-child exit. Failure to eject
or stop the child leaves that directory for disposable runner teardown. Abrupt
job cancellation or runner loss can prevent cleanup/evidence upload; it must be
reported as unverified. The harness does not claim to track WebKit descendants or
all OS caches; GitHub's disposable machine teardown supplies that boundary.

Evidence artifacts contain OS version, native architecture, release hash, source
SHA (`releaseSourceSha`, pinned to `bbf7490b518139d138f5656291724f51b9a97550`),
the separate harness commit (`run.harnessSha`), run/attempt URL, command outcomes
and process observation. Errors after spawn are retained and do not prove exit;
cleanup continues within its bounds and requires an exit event. A
`process-survived` outcome means only the direct executable remained alive for
the observation interval and owned-process cleanup completed.

curl downloads may lack browser quarantine. The harness neither adds nor removes
quarantine, disables Gatekeeper, nor overrides security policy. Real browser
Gatekeeper behavior, Finder/LaunchServices launch, interactive GUI workflows,
Git present/missing, repository folder permissions, installation into Applications,
settings persistence across reopen, upgrade and
full removal remain pending. Smoke evidence alone must not close issue #19 or
authorize a release.

Safe local verification (no RepoDeck launch):

```sh
node --test scripts/mac/hosted-preview-smoke.test.cjs
```
