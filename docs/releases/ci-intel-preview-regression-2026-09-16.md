# Intel Preview CI Timeout Investigation

PR #40 run [35005767992](https://github.com/pulkitchandra1997/RepoDeck/actions/runs/35005767992)
failed on the Intel macOS runner at source `eba5468`.

## Evidence

- All 11 release tests passed on all three targets. Windows and macOS ARM64
  completed their desktop jobs successfully.
- Intel failed in `npm test`, before packaging. Two existing
  `ContentPreview.test.tsx` tests hit the unchanged 5000 ms test timeout:
  full-content clipboard success/failure and page reset when content changes.
  The logged durations were 5602 ms and 11748 ms; the latter can include cleanup
  after the timeout. There was no failed content assertion in the log.
- Intel ran 118 tests: 116 passed and 2 timed out. The frontend step took about
  69 seconds, compared with 12 seconds on ARM64 and 21 seconds on Windows.
  Intel reported 46.78 seconds of aggregate jsdom environment creation.
- The tests render 1000 preview rows and exercise user interactions while
  other test files initialize jsdom and render their own trees. The Vitest
  configuration leaves file parallelism enabled and worker count automatic.

These observations support worker contention as the leading explanation;
local Windows execution cannot prove the behavior of the hosted Intel runner.

## Change and Validation

The Intel matrix entry now runs `npm test -- --maxWorkers=1`. Every test still
runs with file isolation and the default 5000 ms timeout. Windows and ARM64
keep their existing full-suite invocation. There are no retries, skipped tests,
timeout increases, assertion changes or shared-environment shortcuts.

Intel additionally runs all nine `ContentPreview.test.tsx` tests in five fresh
Vitest processes, serially, with one worker. Any failed repetition immediately
fails the job. This complements the existing cold-start readiness repetitions.

The three-target matrix and required `Desktop verification` aggregation are
unchanged. Draft creation still depends on both. The failed run is not rerun;
a new source commit triggers fresh CI. Hosted Intel confirmation remains pending
until that revision passes. No installers are executed locally.

On Windows with Node 24.19.0, the one-worker full suite passed all 118 tests
at the fix revision before main integration (89.15 seconds). The exact new
workflow repetition command then passed all five fresh runs, nine tests each,
with per-run totals of 6.18, 6.54, 5.41, 5.55 and 6.13 seconds. These totals
include environment startup; each individual test retained the 5000 ms limit.
`actionlint.exe -shellcheck= -pyflakes= .github/workflows/verify.yml` and
`git diff --check` passed. These are local results, not an Intel CI pass.

After merging `origin/main` at `77b5e37` (#39) without conflicts or force-pushing,
`npm test -- --maxWorkers=1` passed all 131 tests in 11 files (73.03 seconds),
`npm run test:release` passed all 11 tests, and actionlint plus
`git diff --check origin/main...HEAD` passed. The upstream workspace-search
changes did not overlap the release path. Review and new three-target CI are
still required on the pushed revision.
