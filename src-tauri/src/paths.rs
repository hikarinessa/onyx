use std::path::PathBuf;

/// Returns the Onyx data directory.
///
/// Checks `ONYX_DATA_DIR` env var first (for dev isolation),
/// falls back to `~/.onyx`.
///
/// Usage: `ONYX_DATA_DIR=~/.onyx-dev cargo tauri dev`
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
    Ok(dirs_next::home_dir()
        .ok_or("Could not find home directory")?
        .join(".onyx"))
}
