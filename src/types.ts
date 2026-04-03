/** Mirrors the Rust DirEntry struct returned by list_directory */
export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  extension: string | null;
  /** Seconds since UNIX epoch (modified time) */
  modified: number | null;
  /** Seconds since UNIX epoch (created time) */
  created: number | null;
}
