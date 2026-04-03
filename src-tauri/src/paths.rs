use std::path::PathBuf;

/// Returns the Onyx data directory.
///
/// Priority:
/// 1. `ONYX_DATA_DIR` env var (explicit override)
/// 2. `~/.onyx-dev` in debug builds (`cfg(debug_assertions)`)
/// 3. `~/.onyx` in release builds
pub fn onyx_dir() -> Result<PathBuf, String> {
    if let Ok(custom) = std::env::var("ONYX_DATA_DIR") {
        let expanded = if custom.starts_with('~') {
            let home = dirs_next::home_dir().ok_or("Could not find home directory")?;
            home.join(custom.strip_prefix("~/").unwrap_or(&custom[1..]))
        } else {
            PathBuf::from(custom)
        };
        return Ok(expanded);
    }

    let dir_name = if cfg!(debug_assertions) { ".onyx-dev" } else { ".onyx" };

    Ok(dirs_next::home_dir()
        .ok_or("Could not find home directory")?
        .join(dir_name))
}
