# Security Reports

Do not post credentials, private repository contents or exploitable details in a public issue. When this repository is hosted on GitHub with private vulnerability reporting enabled, use Security > Report a vulnerability. If that channel is unavailable, ask a maintainer for a private reporting channel without disclosing the vulnerability publicly.

Only the latest released version will receive security fixes. RepoDeck currently has no stable release; development builds should not be treated as hardened production software.

Current release blocker: Git inspection can invoke configured clean/process filters while comparing working files. Open only trusted local checkouts with trusted Git configuration. Disabling external diff and filesystem monitor commands does not fully sandbox Git filters. Public stable installers must wait for a tested mitigation; the development release workflow produces drafts only.

Include the version, OS, affected workflow, reproduction with non-sensitive fixtures, expected behavior and observed impact. Existing checks and remaining security limitations are documented in the verification ledger. Git credentials belong in Git/OS credential helpers, not RepoDeck preferences or reports.
