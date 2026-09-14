use crate::{repository::Repository, scanner::Scan};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Report<'a> {
    schema_version: u32,
    workspace: &'a str,
    repositories: Vec<RepositorySummary<'a>>,
    files: &'a [crate::scanner::Entry],
    agent_configs: Vec<&'a str>,
    warnings: &'a [String],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RepositorySummary<'a> {
    name: &'a str,
    branch: Option<&'a str>,
    detached: bool,
    ahead: u64,
    behind: u64,
    changes: &'a [crate::git::Change],
    comparison_notice: &'a str,
}

fn summary(repository: &Repository) -> RepositorySummary<'_> {
    RepositorySummary {
        name: repository
            .path
            .rsplit(['/', '\\'])
            .find(|p| !p.is_empty())
            .unwrap_or("Repository"),
        branch: repository.branch.as_deref(),
        detached: repository.detached,
        ahead: repository.ahead,
        behind: repository.behind,
        changes: &repository.changes,
        comparison_notice: &repository.comparison_notice,
    }
}

pub fn json(name: &str, scan: &Scan, repositories: &[Repository]) -> Result<String, String> {
    let report = Report {
        schema_version: 1,
        workspace: name,
        repositories: repositories.iter().map(summary).collect(),
        files: &scan.entries,
        agent_configs: scan
            .entries
            .iter()
            .filter(|e| e.agent_config)
            .map(|e| e.path.as_str())
            .collect(),
        warnings: &scan.warnings,
    };
    serde_json::to_string_pretty(&report).map_err(|_| "Cannot serialize workspace report".into())
}

fn escape(text: &str) -> String {
    let mut result = String::new();
    for c in text.chars() {
        match c {
            '<' => result.push_str("&lt;"),
            '>' => result.push_str("&gt;"),
            '&' => result.push_str("&amp;"),
            '\n' | '\r' => result.push(' '),
            '\\' | '`' | '*' | '_' | '[' | ']' | '(' | ')' | '#' | '|' | '!' => {
                result.push('\\');
                result.push(c);
            }
            _ => result.push(c),
        }
    }
    result
}

pub fn markdown(name: &str, scan: &Scan, repositories: &[Repository]) -> String {
    let mut output = format!("# {}\n\n## Repositories\n\n", escape(name));
    for repository in repositories {
        let repo = summary(repository);
        let branch = repo.branch.unwrap_or(if repo.detached {
            "Detached HEAD"
        } else {
            "Unknown branch"
        });
        output.push_str(&format!(
            "- {}: {}; {} ahead, {} behind; {} changed/ignored entries\n",
            escape(repo.name),
            escape(branch),
            repo.ahead,
            repo.behind,
            repo.changes.len()
        ));
        if !repo.comparison_notice.is_empty() {
            output.push_str(&format!("  - {}\n", escape(repo.comparison_notice)));
        }
        for change in repo.changes {
            output.push_str(&format!(
                "  - {} [{}{}]\n",
                escape(&change.path),
                change.index,
                change.worktree
            ));
        }
    }
    output.push_str("\n## Files and Folders\n\n");
    for entry in &scan.entries {
        output.push_str(&format!(
            "- {} ({}; {} bytes)\n",
            escape(&entry.path),
            if entry.directory { "folder" } else { "file" },
            entry.size
        ));
    }
    output.push_str("\n## Agent Configurations\n\n");
    for entry in scan.entries.iter().filter(|e| e.agent_config) {
        output.push_str(&format!("- {}\n", escape(&entry.path)));
    }
    output.push_str("\n## Scan Warnings\n\n");
    for warning in &scan.warnings {
        output.push_str(&format!("- {}\n", escape(warning)));
    }
    output
}
