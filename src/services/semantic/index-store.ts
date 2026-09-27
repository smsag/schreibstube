/** Where a vector index is kept: one file, read and written whole. */
export interface IndexStore {
  read(): Promise<ArrayBuffer | null>;
  write(buf: ArrayBuffer): Promise<void>;
  /** The journal file beside this index, where a store has one. */
  journal?(): IndexStore;
  /** When the file was last modified, or null when there is none. Lets an
   *  instance notice another device replacing a file it holds in memory. */
  mtime?(): Promise<number | null>;
}
