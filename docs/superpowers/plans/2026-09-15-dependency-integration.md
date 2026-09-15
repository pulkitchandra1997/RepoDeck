# Dependency Integration

Goal: integrate open dependency PRs without bypassing main protection or release gates.

1. Review upstream package engines, peer constraints and action commits. Integrate
   React plugin 6 with Vite 8; align the documented Node engine with jsdom 30.
2. Regenerate npm and Cargo lockfiles. Run frontend tests and build; fix only
   reproduced upgrade incompatibilities. Keep existing behavioral assertions.
3. Exercise upload/download artifact compatibility on every PR with a checksummed
   fixture, including the merged-directory option used by release packaging.
4. Run release checks, Rust tests, browser metadata checks and lint. Submit a
   consolidated PR referencing superseded updates; require Windows and both Macs.
5. Merge only after required checks pass at the reviewed revision. Close superseded
   PRs with links. Keep issue #14 open for credentials and isolated platform tests
   that cannot be completed on the maintainer's normal account.

No installer lifecycle commands or release approval changes are authorized by this plan.
