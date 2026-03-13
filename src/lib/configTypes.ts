/** Shared config types — single source of truth for TS.
 *  Must match the Rust structs in src-tauri/src/config.rs. */

export interface ThemeColorOverrides {
  bg_base: string;
  bg_surface: string;
  bg_elevated: string;
  text_primary: string;
  text_secondary: string;
  text_tertiary: string;
  accent: string;
  border_default: string;
  border_subtle: string;
}

export interface HeadingStyle {
  size: number;
  color: string;
}

export interface AppConfig {
  editor: {
    font_family: string;
    font_size: number;
    line_height: number;
    content_max_width: number | null;
    default_mode: string;
    show_line_numbers: boolean;
    tab_size: number;
  };
  appearance: {
    theme: string;
    sidebar_width: number;
    context_panel_width: number;
    ui_font: string | null;
    mono_font: string | null;
  };
  behavior: {
    auto_save_ms: number;
    spellcheck: boolean;
    new_note_location: string;
  };
  style: {
    accent_color: string;
    editor_padding_x: number;
    editor_padding_y: number;
    inline_title_size: number;
    ui_font_size: number;
    custom_css: string;
    theme_overrides: Record<string, ThemeColorOverrides>;
    headings: Record<string, HeadingStyle>;
    blockquote_border_color: string;
    blockquote_border_width: number;
    link_color: string;
    link_underline: boolean;
    code_block_bg: string;
    code_block_text: string;
    inline_code_bg: string;
    inline_code_text: string;
    tag_bg: string;
    tag_text: string;
    paragraph_spacing: number;
    list_indent: number;
    syntax_markup: string;
    syntax_hr: string;
    syntax_meta: string;
    syntax_comment: string;
    syntax_list_marker: string;
    syntax_strikethrough: string;
    syntax_highlight_bg: string;
  };
  linting: {
    enabled: boolean;
    autofix_on_save: boolean;
  };
}
