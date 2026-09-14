use serde::Serialize;

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub path: String,
    pub original_path: Option<String>,
    pub index: char,
    pub worktree: char,
}

pub fn parse_status(bytes: &[u8]) -> Result<Vec<Change>, String> {
    if bytes.is_empty() {
        return Ok(Vec::new());
    }
    if bytes.last() != Some(&0) {
        return Err("Truncated Git status output".into());
    }
    let mut records = bytes[..bytes.len() - 1].split(|b| *b == 0);
    let mut changes = Vec::new();
    while let Some(record) = records.next() {
        if record.len() < 4 || record[2] != b' ' {
            return Err("Invalid Git status record".into());
        }
        let index = record[0] as char;
        let worktree = record[1] as char;
        let path = String::from_utf8(record[3..].to_vec())
            .map_err(|_| "Filename cannot be represented as UTF-8")?;
        let original_path = if matches!(index, 'R' | 'C') || matches!(worktree, 'R' | 'C') {
            let source = records
                .next()
                .filter(|s| !s.is_empty())
                .ok_or("Missing rename source")?;
            Some(String::from_utf8(source.to_vec()).map_err(|_| "Invalid source filename")?)
        } else {
            None
        };
        changes.push(Change {
            path,
            original_path,
            index,
            worktree,
        });
    }
    Ok(changes)
}
