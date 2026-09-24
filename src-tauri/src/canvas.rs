//! JSON Canvas 1.0 files (jsoncanvas.org): the links a canvas makes, the text search
//! reads, and the path rewrite a rename needs.
//!
//! Every function works on `serde_json::Value` rather than typed structs, so fields Onyx
//! does not model (another writer's, a later spec's, the `onyx` object) survive a
//! rewrite untouched. serde_json's `preserve_order` feature keeps keys in file order.

use crate::db::{name_key, strip_md, LinkRecord};
use serde::Serialize;
use serde_json::Value;

/// Whether `path` names a canvas file (`.canvas`, spelled as the indexer spells `.md`).
pub fn is_canvas_path(path: &std::path::Path) -> bool {
    path.extension().is_some_and(|e| e == "canvas")
}

fn parse(json: &str) -> Option<Value> {
    serde_json::from_str::<Value>(json).ok().filter(Value::is_object)
}

fn items<'a>(canvas: &'a Value, key: &str) -> &'a [Value] {
    canvas.get(key).and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])
}

fn field<'a>(item: &'a Value, key: &str) -> Option<&'a str> {
    item.get(key).and_then(Value::as_str)
}

fn has_md_extension(path: &str) -> bool {
    strip_md(path).len() != path.len()
}

/// The links a canvas makes, for the index:
///   - each `file` node whose file is a note: the note's path without `.md`. A path
///     relative to the canvas's registered root (how Obsidian writes them) is joined to
///     `root`, so it resolves to exactly that note; an absolute path is kept.
///   - each `[[wikilink]]` or `![[embed]]` in a `text` node, read the way notes are.
/// `line_number` is the node's index in `nodes` (0-based), and `context` the file name
/// for a file node or the line holding the link for a text node, so a backlink reads
/// as the card rather than a line of JSON.
pub fn links(json: &str, root: Option<&str>) -> Vec<LinkRecord> {
    let Some(canvas) = parse(json) else { return Vec::new() };
    let mut out = Vec::new();
    for (i, node) in items(&canvas, "nodes").iter().enumerate() {
        let index = Some(i as i32);
        match field(node, "type") {
            Some("file") => {
                let Some(file) = field(node, "file") else { continue };
                if !has_md_extension(file) {
                    continue;
                }
                let base = strip_md(file);
                let target = match root {
                    Some(r) if !base.starts_with('/') => format!("{}/{}", r.trim_end_matches('/'), base),
                    _ => base.to_string(),
                };
                let name = file.rsplit('/').next().unwrap_or(file);
                out.push(LinkRecord { target, line_number: index, context: Some(name.to_string()) });
            }
            Some("text") => {
                let Some(text) = field(node, "text") else { continue };
                for link in crate::indexer::extract_wikilinks(text) {
                    out.push(LinkRecord { line_number: index, ..link });
                }
            }
            _ => {}
        }
    }
    out
}

/// One searchable item of a canvas that contains the query.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CanvasMatch {
    /// The node's or edge's `id`.
    pub id: String,
    /// Its index in `nodes`, or in `edges` for an edge label.
    pub index: usize,
    /// The first line of its text containing the query.
    pub line: String,
    /// How many times the query occurs in its text.
    pub hits: u32,
}

/// Search the text a person reads on a canvas: card text, group (frame) labels, link
/// card URLs and edge labels. Never keys, ids or coordinates. `query_lower` must
/// already be lowercased.
pub fn search(json: &str, query_lower: &str) -> Vec<CanvasMatch> {
    let Some(canvas) = parse(json) else { return Vec::new() };
    if query_lower.is_empty() {
        return Vec::new();
    }
    fn node_text(node: &Value) -> Option<&str> {
        match field(node, "type") {
            Some("text") => field(node, "text"),
            Some("group") => field(node, "label"),
            Some("link") => field(node, "url"),
            _ => None,
        }
    }
    let nodes = items(&canvas, "nodes").iter().enumerate().map(|(i, n)| (i, n, node_text(n)));
    let edges = items(&canvas, "edges").iter().enumerate().map(|(i, e)| (i, e, field(e, "label")));
    let mut out = Vec::new();
    for (index, item, text) in nodes.chain(edges) {
        let (Some(text), Some(id)) = (text, field(item, "id")) else { continue };
        let mut hits = 0;
        let mut first = None;
        for line in text.lines() {
            let n = line.to_lowercase().matches(query_lower).count() as u32;
            if n > 0 && first.is_none() {
                first = Some(line);
            }
            hits += n;
        }
        if let Some(line) = first {
            out.push(CanvasMatch { id: id.to_string(), index, line: line.to_string(), hits });
        }
    }
    out
}

/// A renamed or moved file or folder, as absolute paths.
pub struct PathMove<'a> {
    pub old: &'a str,
    pub new: &'a str,
    pub is_dir: bool,
}

/// Where a file node's `file` points after `moved`, written in the form it was: a path
/// relative to `root` stays relative when the new location is under the same root,
/// otherwise it becomes absolute; an absolute path stays absolute. None when the node
/// does not point at the moved file or into the moved folder.
fn moved_file_path(file: &str, root: Option<&str>, moved: &PathMove) -> Option<String> {
    let absolute = file.starts_with('/');
    let abs = if absolute {
        file.to_string()
    } else {
        format!("{}/{}", root?.trim_end_matches('/'), file)
    };
    let old = moved.old.trim_end_matches('/');
    // Compare the way link resolution does (case-folded); the cut must land on a
    // character boundary of the node's own spelling.
    let head = abs.get(..old.len())?;
    if name_key(head) != name_key(old) {
        return None;
    }
    let rest = &abs[old.len()..];
    let inside = if moved.is_dir { rest.starts_with('/') } else { rest.is_empty() };
    if !inside {
        return None;
    }
    let new_abs = format!("{}{}", moved.new.trim_end_matches('/'), rest);
    if !absolute {
        if let Some(r) = root {
            if let Some(rel) = new_abs.strip_prefix(&format!("{}/", r.trim_end_matches('/'))) {
                return Some(rel.to_string());
            }
        }
    }
    Some(new_abs)
}

/// Rewrite a canvas after a rename: `file` fields of file nodes pointing at the moved
/// file or into the moved folder (`moved`, with `root` the canvas's registered root),
/// and the text of text nodes through `rewrite_text` (the wikilink rewrite notes get).
/// Everything else is kept as it was, key order included. Returns None when nothing
/// changed or the file is not a JSON Canvas object.
///
/// Output is serde_json's pretty form with tab indentation, which is byte-identical to
/// JavaScript's `JSON.stringify(canvas, null, "\t")` for the same key order; a trailing
/// newline is kept if the input had one.
pub fn rewrite_paths(
    json: &str,
    root: Option<&str>,
    moved: Option<&PathMove>,
    rewrite_text: Option<&dyn Fn(&str) -> String>,
) -> Option<String> {
    let mut canvas = parse(json)?;
    let mut changed = false;
    if let Some(nodes) = canvas.get_mut("nodes").and_then(Value::as_array_mut) {
        for node in nodes.iter_mut() {
            let Some(obj) = node.as_object_mut() else { continue };
            let key = match obj.get("type").and_then(Value::as_str) {
                Some("file") => "file",
                Some("text") => "text",
                _ => continue,
            };
            let Some(current) = obj.get(key).and_then(Value::as_str) else { continue };
            let replacement = match key {
                "file" => moved.and_then(|m| moved_file_path(current, root, m)),
                _ => rewrite_text.map(|f| f(current)).filter(|t| t != current),
            };
            if let Some(new_value) = replacement {
                obj.insert(key.to_string(), Value::String(new_value));
                changed = true;
            }
        }
    }
    if !changed {
        return None;
    }
    let mut out = to_pretty(&canvas);
    if json.ends_with('\n') {
        out.push('\n');
    }
    Some(out)
}

fn to_pretty(value: &Value) -> String {
    let mut buf = Vec::new();
    let formatter = serde_json::ser::PrettyFormatter::with_indent(b"\t");
    let mut ser = serde_json::Serializer::with_formatter(&mut buf, formatter);
    value.serialize(&mut ser).expect("a JSON value always serialises");
    String::from_utf8(buf).expect("serde_json writes UTF-8")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    const BOARD: &str = r##"{
	"nodes": [
		{
			"id": "t1",
			"type": "text",
			"text": "Plan with [[Alpha]] and ![[Beta#Goals|b]]\nSecond line mentions Needle",
			"x": 0,
			"y": 0,
			"width": 250,
			"height": 60,
			"color": "4",
			"onyx": {
				"kind": "sticky",
				"color": "teal"
			},
			"futureField": [
				1,
				2
			]
		},
		{
			"id": "f1",
			"type": "file",
			"file": "Projects/Sub/Gamma.md",
			"subpath": "#Heading",
			"x": 300,
			"y": 0,
			"width": 400,
			"height": 400
		},
		{
			"id": "f2",
			"type": "file",
			"file": "Images/photo.png",
			"x": 0,
			"y": 500,
			"width": 200,
			"height": 200
		},
		{
			"id": "f3",
			"type": "file",
			"file": "/elsewhere/Delta.md",
			"x": 0,
			"y": 800,
			"width": 200,
			"height": 200
		},
		{
			"id": "g1",
			"type": "group",
			"label": "Needle frame",
			"x": -50,
			"y": -50,
			"width": 900,
			"height": 1200
		},
		{
			"id": "l1",
			"type": "link",
			"url": "https://example.com/needle",
			"x": 900,
			"y": 0,
			"width": 300,
			"height": 200
		}
	],
	"edges": [
		{
			"id": "e1",
			"fromNode": "t1",
			"fromSide": "right",
			"toNode": "f1",
			"toSide": "left",
			"label": "leads to needle",
			"onyx": {
				"dash": true
			}
		}
	],
	"onyx": {
		"version": 1
	},
	"otherApp": {
		"zoom": 2
	}
}"##;

    #[test]
    fn links_come_from_note_file_nodes_and_wikilinks_in_text() {
        let got = links(BOARD, Some("/v"));
        let summary: Vec<(&str, Option<i32>, Option<&str>)> = got
            .iter()
            .map(|l| (l.target.as_str(), l.line_number, l.context.as_deref()))
            .collect();
        assert_eq!(summary, vec![
            ("Alpha", Some(0), Some("Plan with [[Alpha]] and ![[Beta#Goals|b]]")),
            ("Beta", Some(0), Some("Plan with [[Alpha]] and ![[Beta#Goals|b]]")),
            ("/v/Projects/Sub/Gamma", Some(1), Some("Gamma.md")),
            ("/elsewhere/Delta", Some(3), Some("Delta.md")),
        ]);
    }

    #[test]
    fn without_a_root_a_relative_file_path_is_stored_as_written() {
        let got = links(BOARD, None);
        assert!(got.iter().any(|l| l.target == "Projects/Sub/Gamma"));
    }

    #[test]
    fn a_canvas_without_nodes_or_edges_parses_and_has_nothing() {
        for json in ["{}", "{\"nodes\": []}", "{\"edges\": []}"] {
            assert!(links(json, Some("/v")).is_empty(), "{json}");
            assert!(search(json, "x").is_empty(), "{json}");
            assert_eq!(rewrite_paths(json, Some("/v"), None, None), None, "{json}");
        }
    }

    #[test]
    fn invalid_json_gives_no_links_matches_or_rewrite() {
        for json in ["", "not json", "[1,2]", "{\"nodes\": "] {
            assert!(links(json, Some("/v")).is_empty(), "{json}");
            assert!(search(json, "x").is_empty(), "{json}");
            let moved = PathMove { old: "/v/a.md", new: "/v/b.md", is_dir: false };
            assert_eq!(rewrite_paths(json, Some("/v"), Some(&moved), None), None, "{json}");
        }
    }

    #[test]
    fn search_reads_card_text_labels_and_urls_but_not_keys_or_ids() {
        let got = search(BOARD, "needle");
        let summary: Vec<(&str, usize, &str, u32)> =
            got.iter().map(|m| (m.id.as_str(), m.index, m.line.as_str(), m.hits)).collect();
        assert_eq!(summary, vec![
            ("t1", 0, "Second line mentions Needle", 1),
            ("g1", 4, "Needle frame", 1),
            ("l1", 5, "https://example.com/needle", 1),
            ("e1", 0, "leads to needle", 1),
        ]);
        assert!(search(BOARD, "fromnode").is_empty(), "keys are not searched");
        assert!(search(BOARD, "t1").is_empty(), "ids are not searched");
        assert!(search(BOARD, "gamma").is_empty(), "file paths are not searched");
    }

    #[test]
    fn a_note_rename_rewrites_its_file_node_and_nothing_else() {
        let moved = PathMove { old: "/v/Projects/Sub/Gamma.md", new: "/v/Projects/Sub/Omega.md", is_dir: false };
        let out = rewrite_paths(BOARD, Some("/v"), Some(&moved), None).unwrap();
        assert_eq!(out, BOARD.replace("Projects/Sub/Gamma.md", "Projects/Sub/Omega.md"));
    }

    #[test]
    fn output_keeps_key_order_unknown_fields_and_the_onyx_object() {
        // BOARD is already in the output format, so a rewrite changes only the path:
        // every unknown top-level and per-node field, and each `onyx` object, is
        // written back where it was.
        let moved = PathMove { old: "/v/Images/photo.png", new: "/v/Images/beach.png", is_dir: false };
        let out = rewrite_paths(BOARD, Some("/v"), Some(&moved), None).unwrap();
        assert_eq!(out, BOARD.replace("Images/photo.png", "Images/beach.png"));
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["otherApp"]["zoom"], 2);
        assert_eq!(v["onyx"]["version"], 1);
        assert_eq!(v["nodes"][0]["onyx"]["kind"], "sticky");
        assert_eq!(v["nodes"][0]["futureField"][1], 2);
        assert_eq!(v["edges"][0]["onyx"]["dash"], true);
    }

    #[test]
    fn a_compact_file_is_rewritten_in_tab_indented_form_with_its_trailing_newline() {
        let json = "{\"nodes\":[{\"id\":\"a\",\"type\":\"file\",\"file\":\"x.md\",\"x\":1}],\"edges\":[]}\n";
        let moved = PathMove { old: "/v/x.md", new: "/v/y.md", is_dir: false };
        let out = rewrite_paths(json, Some("/v"), Some(&moved), None).unwrap();
        assert_eq!(
            out,
            "{\n\t\"nodes\": [\n\t\t{\n\t\t\t\"id\": \"a\",\n\t\t\t\"type\": \"file\",\n\t\t\t\"file\": \"y.md\",\n\t\t\t\"x\": 1\n\t\t}\n\t],\n\t\"edges\": []\n}\n"
        );
    }

    #[test]
    fn a_folder_rename_moves_every_file_node_under_it() {
        let json = r#"{"nodes":[
            {"id":"a","type":"file","file":"Projects/Sub/Gamma.md"},
            {"id":"b","type":"file","file":"Projects/Sub/pic.png"},
            {"id":"c","type":"file","file":"Projects/Subway.md"},
            {"id":"d","type":"file","file":"/v/Projects/Sub/Abs.md"}
        ]}"#;
        let moved = PathMove { old: "/v/Projects/Sub", new: "/v/Archive/Sub", is_dir: true };
        let out: Value = serde_json::from_str(&rewrite_paths(json, Some("/v"), Some(&moved), None).unwrap()).unwrap();
        let files: Vec<&str> = out["nodes"].as_array().unwrap().iter().map(|n| n["file"].as_str().unwrap()).collect();
        assert_eq!(files, ["Archive/Sub/Gamma.md", "Archive/Sub/pic.png", "Projects/Subway.md", "/v/Archive/Sub/Abs.md"]);
    }

    #[test]
    fn a_move_out_of_the_root_makes_a_relative_path_absolute() {
        let json = r#"{"nodes":[{"id":"a","type":"file","file":"Notes/Gamma.md"}]}"#;
        let moved = PathMove { old: "/v/Notes/Gamma.md", new: "/w/Gamma.md", is_dir: false };
        let out: Value = serde_json::from_str(&rewrite_paths(json, Some("/v"), Some(&moved), None).unwrap()).unwrap();
        assert_eq!(out["nodes"][0]["file"], "/w/Gamma.md");
    }

    #[test]
    fn file_paths_match_case_insensitively_like_link_resolution() {
        let json = r#"{"nodes":[{"id":"a","type":"file","file":"notes/gamma.md"}]}"#;
        let moved = PathMove { old: "/v/Notes/Gamma.md", new: "/v/Notes/Omega.md", is_dir: false };
        let out: Value = serde_json::from_str(&rewrite_paths(json, Some("/v"), Some(&moved), None).unwrap()).unwrap();
        assert_eq!(out["nodes"][0]["file"], "Notes/Omega.md");
    }

    #[test]
    fn text_nodes_get_the_wikilink_rewrite_notes_get() {
        let targets: HashSet<String> = ["Alpha".to_string()].into_iter().collect();
        let rewrite = |t: &str| crate::commands::rewrite_wikilinks(t, "Alpha", "Zeta", &targets);
        let out = rewrite_paths(BOARD, Some("/v"), None, Some(&rewrite)).unwrap();
        assert_eq!(out, BOARD.replace("[[Alpha]]", "[[Zeta]]"));
    }

    #[test]
    fn nothing_to_change_returns_none() {
        let moved = PathMove { old: "/v/Unrelated.md", new: "/v/Other.md", is_dir: false };
        let targets: HashSet<String> = HashSet::new();
        let rewrite = |t: &str| crate::commands::rewrite_wikilinks(t, "Unrelated", "Other", &targets);
        assert_eq!(rewrite_paths(BOARD, Some("/v"), Some(&moved), Some(&rewrite)), None);
    }
}
