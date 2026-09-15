# macOS Watcher Fixture Regression

Issue: [#12](https://github.com/pulkitchandra1997/RepoDeck/issues/12).

Diagnostic CI run 34930135491, job 104256448683, captured a failing event batch
containing the temporary workspace root, its `.git` directory, `node_modules`,
and `node_modules/generated.txt`. The first two paths were created during fixture
setup and are correctly relevant to the watcher. FSEvents delivered those setup
events after watch registration; the exclusion assertion was measuring startup
traffic as well as the excluded write.

The test now writes a readiness file, observes a live watcher, and drains startup
events until a bounded quiet interval. Only then does it write the excluded file.
The negative assertion specifically requires a timeout, not a disconnected channel.
The `.git/HEAD` check uses a separate fixture so an excluded write cannot satisfy
it. Both observation windows are five seconds. Production filtering is unchanged;
temporary path diagnostics were removed.

Local Windows verification:

- `cargo test --locked -p repodeck-core --test watch`: all four tests passed.
- Mutation check: temporarily remove `node_modules` from the test's exclusions;
  the negative assertion fails as expected. Restore it; all four tests pass again.
- `cargo fmt --all --check`: passed before the final documentation-only addition.

Independent review identified the delayed-event cross-check gap and the previous
host-architecture ambiguity. The fixtures are now separate, and CI uses explicit
`macos-15` ARM64 and `macos-15-intel` x64 runners. See
[GitHub's runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

CI adds 15 consecutive watcher-suite executions on each native macOS matrix job.
Consult PR #13 checks for results against the final revision. This is watcher
fixture verification, not native UI or installation lifecycle testing.
