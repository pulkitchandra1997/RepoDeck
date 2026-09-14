use url::Url;

fn parse(value: &str) -> Result<Url, String> {
    if value.len() > 8192 || value.chars().any(|c| c.is_control() || c == '\\') {
        return Err("Invalid remote address".into());
    }
    let url = Url::parse(value).map_err(|_| "Invalid remote address")?;
    if !url.has_host() || url.path().trim_matches('/').is_empty() {
        return Err("The remote has no repository path".into());
    }
    Ok(url)
}

pub fn browser_target(remote: &str) -> Result<String, String> {
    let input = if !remote.contains("://") {
        let (host, path) = remote
            .split_once(':')
            .ok_or("No browser URL for this remote")?;
        if !host.contains('@') || host.contains('/') || path.is_empty() {
            return Err("No browser URL for this remote".into());
        }
        format!("ssh://{host}/{path}")
    } else {
        remote.to_string()
    };
    let mut url = parse(&input)?;
    match url.scheme() {
        "http" | "https" => {}
        "ssh" => {
            if url.port().is_some_and(|port| port != 22) {
                return Err("The SSH port does not identify the browser address".into());
            }
            // Reparse because url rejects changing non-special SSH to special HTTPS.
            url = parse(&format!(
                "https://{}{}",
                url.host_str().ok_or("Missing host")?,
                url.path()
            ))?;
        }
        _ => return Err("Only HTTP, HTTPS and SSH remotes have browser targets".into()),
    }
    url.set_username("")
        .map_err(|_| "Invalid remote username")?;
    url.set_password(None)
        .map_err(|_| "Invalid remote password")?;
    url.set_query(None);
    url.set_fragment(None);
    let path = url.path().trim_end_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path).to_string();
    url.set_path(&path);
    validate_browser_url(url.as_str())
}

pub fn validate_browser_url(value: &str) -> Result<String, String> {
    let url = parse(value)?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Only credential-free HTTP or HTTPS browser URLs are allowed".into());
    }
    Ok(url.into())
}
