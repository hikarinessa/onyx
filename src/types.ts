/** Mirrors the Rust DirEntry struct returned by list_directory */
export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  extension: string | null;
}
