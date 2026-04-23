use chrono::{Datelike, NaiveDate};
use minijinja::value::Rest;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

static DATE_FORMAT_RE: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"\{\{date:([^}]+)\}\}").unwrap());

static CURSOR_RE: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"\{\{\s*cursor\s*\}\}").unwrap());

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeriodicConfig {
    pub daily: Option<PeriodConfig>,
    pub weekly: Option<PeriodConfig>,
    pub monthly: Option<PeriodConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeriodConfig {
    pub enabled: bool,
    /// ID of a registered directory (from directories.json)
    pub directory_id: String,
    /// Path format using moment-style tokens: YYYY, MM, DD, Www, etc.
    pub format: String,
    /// Relative path to template file within the same directory
    pub template: Option<String>,
}

fn config_path() -> Result<PathBuf, String> {
    Ok(crate::paths::onyx_dir()?.join("periodic-notes.json"))
}

fn default_config() -> PeriodicConfig {
    PeriodicConfig {
        daily: Some(PeriodConfig {
            enabled: false,
            directory_id: String::new(),
            format: "Calendar/YYYY/YYYY-MM/YYYY-MM-DD".to_string(),
            template: Some("Meta/Templates/Daily.md".to_string()),
        }),
        weekly: Some(PeriodConfig {
            enabled: false,
            directory_id: String::new(),
            format: "Calendar/YYYY/Weeklies/YYYY-Www".to_string(),
            template: Some("Meta/Templates/Weekly.md".to_string()),
        }),
        monthly: Some(PeriodConfig {
            enabled: false,
            directory_id: String::new(),
            format: "Calendar/YYYY/Monthlies/YYYY-MM".to_string(),
            template: Some("Meta/Templates/Monthly.md".to_string()),
        }),
    }
}

pub fn load_config() -> Result<PeriodicConfig, String> {
    let path = config_path()?;

    if !path.exists() {
        let config = default_config();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create config directory: {}", e))?;
        }
        let json = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize periodic config: {}", e))?;
        std::fs::write(&path, json)
            .map_err(|e| format!("Failed to write periodic-notes.json: {}", e))?;
        return Ok(config);
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read periodic-notes.json: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse periodic-notes.json: {}", e))
}

pub fn save_config(config: &PeriodicConfig) -> Result<(), String> {
    let path = config_path()?;
    let dir = path.parent().ok_or("Invalid config path")?;
    std::fs::create_dir_all(dir)
        .map_err(|e| format!("Failed to create config directory: {}", e))?;
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize periodic config: {}", e))?;

    // Atomic write: temp + rename
    let temp_path = dir.join(".periodic-notes-tmp");
    std::fs::write(&temp_path, &json)
        .map_err(|e| format!("Failed to write periodic config temp file: {}", e))?;
    std::fs::rename(&temp_path, &path).map_err(|e| {
        let _ = std::fs::remove_file(&temp_path);
        format!("Failed to rename periodic config temp file: {}", e)
    })
}

// ── Date formatting (moment.js-compatible tokens) ──

/// Format a date using moment.js-style tokens.
/// Supported: YYYY, YY, MMMM, MMM, MM, M, DD, D, dddd, ddd, dd, Www, WW, W
pub fn format_date(date: NaiveDate, format: &str) -> String {
    let mut result = String::with_capacity(format.len() + 16);
    let chars: Vec<char> = format.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        // Try longest token first
        if i + 4 <= len {
            let tok4: String = chars[i..i + 4].iter().collect();
            match tok4.as_str() {
                "YYYY" => {
                    result.push_str(&format!("{:04}", date.year()));
                    i += 4;
                    continue;
                }
                "MMMM" => {
                    result.push_str(month_name_long(date.month()));
                    i += 4;
                    continue;
                }
                "dddd" => {
                    result.push_str(weekday_name_long(date.weekday()));
                    i += 4;
                    continue;
                }
                _ => {}
            }
        }

        if i + 3 <= len {
            let tok3: String = chars[i..i + 3].iter().collect();
            match tok3.as_str() {
                "MMM" => {
                    result.push_str(month_name_short(date.month()));
                    i += 3;
                    continue;
                }
                "ddd" => {
                    result.push_str(weekday_name_short(date.weekday()));
                    i += 3;
                    continue;
                }
                "Www" => {
                    result.push_str(&format!("W{:02}", date.iso_week().week()));
                    i += 3;
                    continue;
                }
                _ => {}
            }
        }

        if i + 2 <= len {
            let tok2: String = chars[i..i + 2].iter().collect();
            match tok2.as_str() {
                "YY" => {
                    result.push_str(&format!("{:02}", date.year() % 100));
                    i += 2;
                    continue;
                }
                "MM" => {
                    result.push_str(&format!("{:02}", date.month()));
                    i += 2;
                    continue;
                }
                "DD" => {
                    result.push_str(&format!("{:02}", date.day()));
                    i += 2;
                    continue;
                }
                "dd" => {
                    result.push_str(weekday_name_min(date.weekday()));
                    i += 2;
                    continue;
                }
                "WW" => {
                    result.push_str(&format!("{:02}", date.iso_week().week()));
                    i += 2;
                    continue;
                }
                _ => {}
            }
        }

        // Single-char tokens
        match chars[i] {
            'M' if !is_alpha(chars.get(i + 1)) && !is_alpha_before(i, &chars) => {
                result.push_str(&date.month().to_string());
                i += 1;
                continue;
            }
            'D' if !is_alpha(chars.get(i + 1)) && !is_alpha_before(i, &chars) => {
                result.push_str(&date.day().to_string());
                i += 1;
                continue;
            }
            'W' if !is_alpha(chars.get(i + 1)) && !is_alpha_before(i, &chars) => {
                result.push_str(&date.iso_week().week().to_string());
                i += 1;
                continue;
            }
            _ => {
                result.push(chars[i]);
                i += 1;
            }
        }
    }

    result
}

fn is_alpha(c: Option<&char>) -> bool {
    c.map_or(false, |c| c.is_ascii_alphabetic())
}

fn is_alpha_before(i: usize, chars: &[char]) -> bool {
    if i == 0 { return false; }
    chars[i - 1].is_ascii_alphabetic()
}

fn month_name_long(m: u32) -> &'static str {
    match m {
        1 => "January", 2 => "February", 3 => "March", 4 => "April",
        5 => "May", 6 => "June", 7 => "July", 8 => "August",
        9 => "September", 10 => "October", 11 => "November", 12 => "December",
        _ => "",
    }
}

fn month_name_short(m: u32) -> &'static str {
    match m {
        1 => "Jan", 2 => "Feb", 3 => "Mar", 4 => "Apr",
        5 => "May", 6 => "Jun", 7 => "Jul", 8 => "Aug",
        9 => "Sep", 10 => "Oct", 11 => "Nov", 12 => "Dec",
        _ => "",
    }
}

fn weekday_name_long(wd: chrono::Weekday) -> &'static str {
    match wd {
        chrono::Weekday::Mon => "Monday", chrono::Weekday::Tue => "Tuesday",
        chrono::Weekday::Wed => "Wednesday", chrono::Weekday::Thu => "Thursday",
        chrono::Weekday::Fri => "Friday", chrono::Weekday::Sat => "Saturday",
        chrono::Weekday::Sun => "Sunday",
    }
}

fn weekday_name_short(wd: chrono::Weekday) -> &'static str {
    match wd {
        chrono::Weekday::Mon => "Mon", chrono::Weekday::Tue => "Tue",
        chrono::Weekday::Wed => "Wed", chrono::Weekday::Thu => "Thu",
        chrono::Weekday::Fri => "Fri", chrono::Weekday::Sat => "Sat",
        chrono::Weekday::Sun => "Sun",
    }
}

fn weekday_name_min(wd: chrono::Weekday) -> &'static str {
    match wd {
        chrono::Weekday::Mon => "Mo", chrono::Weekday::Tue => "Tu",
        chrono::Weekday::Wed => "We", chrono::Weekday::Thu => "Th",
        chrono::Weekday::Fri => "Fr", chrono::Weekday::Sat => "Sa",
        chrono::Weekday::Sun => "Su",
    }
}

// ── Template rendering ──

/// Render a template with periodic note variables.
/// Pre-processes `{{date:FORMAT}}` before passing to minijinja.
/// Registers a `script(name, ...args)` function that invokes a user script
/// from `~/.onyx/scripts/` with context supplied via env vars.
/// Returns (rendered content, optional cursor byte offset).
pub fn render_template(
    template_content: &str,
    date: NaiveDate,
    title: &str,
    file_path: &Path,
) -> Result<(String, Option<usize>), String> {
    // Pre-process {{date:FORMAT}} patterns (before minijinja sees them)
    let preprocessed = DATE_FORMAT_RE.replace_all(template_content, |caps: &regex::Captures| {
        let fmt = caps.get(1).unwrap().as_str();
        format_date(date, fmt)
    }).to_string();

    // Replace `{{ cursor }}` (whitespace-tolerant) with a placeholder before minijinja processes it
    let cursor_placeholder = "\x00CURSOR\x00";
    let preprocessed = CURSOR_RE.replace_all(&preprocessed, cursor_placeholder).to_string();

    // Set up minijinja
    let mut env = minijinja::Environment::new();
    env.set_undefined_behavior(minijinja::UndefinedBehavior::Chainable);

    // Script execution context — captured by the `script` function
    let script_env = build_script_env(date, title, file_path);
    env.add_function("script", move |args: Rest<minijinja::Value>| -> Result<String, minijinja::Error> {
        let mut it = args.iter();
        let name = it.next()
            .and_then(|v| v.as_str().map(String::from))
            .ok_or_else(|| minijinja::Error::new(
                minijinja::ErrorKind::InvalidOperation,
                "script() requires at least a name argument",
            ))?;
        let rest: Vec<String> = it.map(|v| v.to_string()).collect();
        let info = crate::scripts::find_script(&name)
            .map_err(|e| minijinja::Error::new(minijinja::ErrorKind::InvalidOperation, e))?;
        crate::scripts::run_script(&info, &rest, &script_env)
            .map_err(|e| minijinja::Error::new(minijinja::ErrorKind::InvalidOperation, e))
    });

    env.add_template("note", &preprocessed)
        .map_err(|e| format!("Failed to parse template: {}", e))?;

    let tmpl = env.get_template("note")
        .map_err(|e| format!("Failed to get template: {}", e))?;

    let yesterday = date.pred_opt().unwrap_or(date);
    let tomorrow = date.succ_opt().unwrap_or(date);
    // For leap year Feb 29, fall back to Feb 28 of previous year
    let last_year = date.with_year(date.year() - 1)
        .unwrap_or_else(|| NaiveDate::from_ymd_opt(date.year() - 1, date.month(), 28)
            .unwrap_or(date));

    let now = chrono::Local::now();
    let time_str = now.format("%H:%M").to_string();

    let ctx = minijinja::context! {
        date => format_date(date, "YYYY-MM-DD"),
        title => title,
        time => time_str,
        yesterday => format!("[[{}]]", format_date(yesterday, "YYYY-MM-DD")),
        tomorrow => format!("[[{}]]", format_date(tomorrow, "YYYY-MM-DD")),
        last_year => format!("[[{}]]", format_date(last_year, "YYYY-MM-DD")),
    };

    let mut rendered = tmpl.render(ctx)
        .map_err(|e| format!("Failed to render template: {}", e))?;

    // Handle cursor placeholder — find and strip it, return the offset
    let cursor_offset = rendered.find(cursor_placeholder);
    if cursor_offset.is_some() {
        rendered = rendered.replace(cursor_placeholder, "");
    }

    Ok((rendered, cursor_offset))
}

/// Generate the file path for a periodic note.
/// Returns (relative_path_with_extension, title).
pub fn generate_note_path(format: &str, date: NaiveDate) -> (String, String) {
    let relative = format_date(date, format);
    let title = relative.rsplit('/').next().unwrap_or(&relative).to_string();
    (format!("{}.md", relative), title)
}

/// Build the environment variables a script receives when invoked during template rendering.
pub fn build_script_env(
    date: NaiveDate,
    title: &str,
    file_path: &Path,
) -> std::collections::HashMap<String, String> {
    let mut env = std::collections::HashMap::new();
    env.insert("ONYX_NOTE_PATH".to_string(), file_path.to_string_lossy().to_string());
    env.insert("ONYX_NOTE_DATE".to_string(), format_date(date, "YYYY-MM-DD"));
    env.insert("ONYX_NOTE_TITLE".to_string(), title.to_string());
    if let Some(parent) = file_path.parent() {
        env.insert("ONYX_NOTE_DIR".to_string(), parent.to_string_lossy().to_string());
    }
    env
}

/// Convenience: render a template for a newly created file whose date isn't known from a period config.
/// Uses today's date and the filename stem as title.
pub fn render_template_for_path(
    template_content: &str,
    file_path: &Path,
) -> Result<(String, Option<usize>), String> {
    let date = chrono::Local::now().date_naive();
    let title = file_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled")
        .to_string();
    render_template(template_content, date, &title, file_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    #[test]
    fn test_format_date_basic() {
        let d = NaiveDate::from_ymd_opt(2026, 3, 12).unwrap();
        assert_eq!(format_date(d, "YYYY-MM-DD"), "2026-03-12");
        assert_eq!(format_date(d, "YYYY/MM/DD"), "2026/03/12");
        assert_eq!(format_date(d, "YY-M-D"), "26-3-12");
    }

    #[test]
    fn test_format_date_with_text() {
        let d = NaiveDate::from_ymd_opt(2026, 3, 12).unwrap();
        assert_eq!(
            format_date(d, "Calendar/YYYY/YYYY-MM/YYYY-MM-DD"),
            "Calendar/2026/2026-03/2026-03-12"
        );
    }

    #[test]
    fn test_format_date_weekday_names() {
        let d = NaiveDate::from_ymd_opt(2026, 3, 12).unwrap(); // Thursday
        assert_eq!(format_date(d, "dddd"), "Thursday");
        assert_eq!(format_date(d, "ddd"), "Thu");
        assert_eq!(format_date(d, "dd"), "Th");
    }

    #[test]
    fn test_format_date_month_names() {
        let d = NaiveDate::from_ymd_opt(2026, 3, 12).unwrap();
        assert_eq!(format_date(d, "MMMM"), "March");
        assert_eq!(format_date(d, "MMM"), "Mar");
    }

    #[test]
    fn test_format_date_iso_week() {
        let d = NaiveDate::from_ymd_opt(2026, 3, 12).unwrap();
        let result = format_date(d, "Calendar/YYYY/Weeklies/YYYY-Www");
        assert!(result.starts_with("Calendar/2026/Weeklies/2026-W"));
    }

    #[test]
    fn test_format_date_year_boundary() {
        // Dec 31 → tomorrow is Jan 1
        let d = NaiveDate::from_ymd_opt(2026, 12, 31).unwrap();
        assert_eq!(format_date(d, "YYYY-MM-DD"), "2026-12-31");
    }

    #[test]
    fn test_format_date_leap_year() {
        let d = NaiveDate::from_ymd_opt(2024, 2, 29).unwrap();
        assert_eq!(format_date(d, "YYYY-MM-DD"), "2024-02-29");
    }

    #[test]
    fn test_generate_note_path() {
        let d = NaiveDate::from_ymd_opt(2026, 3, 12).unwrap();
        let (path, title) = generate_note_path("Calendar/YYYY/YYYY-MM/YYYY-MM-DD", d);
        assert_eq!(path, "Calendar/2026/2026-03/2026-03-12.md");
        assert_eq!(title, "2026-03-12");
    }

    #[test]
    fn test_render_template_basic() {
        let d = NaiveDate::from_ymd_opt(2026, 3, 12).unwrap();
        let tmpl = "# {{ title }}\nDate: {{ date }}\n";
        let (rendered, cursor) = render_template(tmpl, d, "2026-03-12", Path::new("/tmp/test.md")).unwrap();
        assert!(rendered.contains("# 2026-03-12"));
        assert!(rendered.contains("Date: 2026-03-12"));
        assert!(cursor.is_none());
    }

    #[test]
    fn test_render_template_wikilinks() {
        let d = NaiveDate::from_ymd_opt(2026, 3, 12).unwrap();
        let tmpl = "Yesterday: {{ yesterday }}\nTomorrow: {{ tomorrow }}";
        let (rendered, _) = render_template(tmpl, d, "2026-03-12", Path::new("/tmp/test.md")).unwrap();
        assert!(rendered.contains("[[2026-03-11]]"));
        assert!(rendered.contains("[[2026-03-13]]"));
    }

    #[test]
    fn test_render_template_year_boundary_links() {
        let d = NaiveDate::from_ymd_opt(2026, 12, 31).unwrap();
        let tmpl = "Tomorrow: {{ tomorrow }}";
        let (rendered, _) = render_template(tmpl, d, "2026-12-31", Path::new("/tmp/test.md")).unwrap();
        assert!(rendered.contains("[[2027-01-01]]"));
    }

    #[test]
    fn test_render_template_cursor() {
        let d = NaiveDate::from_ymd_opt(2026, 3, 12).unwrap();
        let tmpl = "# Title\n{{cursor}}";
        let (rendered, cursor) = render_template(tmpl, d, "test", Path::new("/tmp/test.md")).unwrap();
        assert!(!rendered.contains("{{cursor}}"));
        assert!(cursor.is_some());
        assert_eq!(cursor.unwrap(), 8); // "# Title\n" = 8 bytes
    }

    #[test]
    fn test_render_template_date_format() {
        let d = NaiveDate::from_ymd_opt(2026, 3, 12).unwrap();
        let tmpl = "Today is {{date:dddd, MMMM DD, YYYY}}";
        let (rendered, _) = render_template(tmpl, d, "test", Path::new("/tmp/test.md")).unwrap();
        assert_eq!(rendered, "Today is Thursday, March 12, 2026");
    }

    #[test]
    fn test_render_template_no_variables() {
        let d = NaiveDate::from_ymd_opt(2026, 3, 12).unwrap();
        let tmpl = "Just plain text with no variables.";
        let (rendered, _) = render_template(tmpl, d, "test", Path::new("/tmp/test.md")).unwrap();
        assert_eq!(rendered, tmpl);
    }
}
