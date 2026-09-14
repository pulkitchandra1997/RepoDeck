# GitHub Publication and Release Plan

1. Confirm owner and visibility before creating the remote; audit staged files before the first push. Never include local settings, test workspaces, downloaded repositories, secrets, build outputs or installers in Git history.
2. Retain the existing MIT license and declare it consistently in npm, Cargo and the installer. Preserve third-party licensing separately.
3. Extend verification CI with version consistency checks and tag-triggered packaging. Build Windows x64, macOS ARM64 and macOS Intel on appropriate runners using locked dependency resolution.
4. Stage explicitly named installer assets with SHA-256 checksums and source commit metadata. Reject missing, duplicate, empty or unexpected bundles. Use GitHub Releases for binaries, not Git/LFS or expiring Actions artifacts as the permanent download channel.
5. Create draft prereleases only after all build/test jobs pass. Do not publish stable versions until native lifecycle, signing/notarization and third-party notice gates are reviewed. Never overwrite released tags/assets.
6. Independently review frontend and native backend bugs, reproduce findings, implement scoped repairs with tests, and record unresolved release blockers.
7. Initialize local Git, inspect the staged inventory and secret scan, commit, create the approved remote, push and inspect CI. Do not claim cloud builds passed before their results are available.
