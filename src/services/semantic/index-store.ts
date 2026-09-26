/** Where a vector index is kept: one file, read and written whole. */
export interface IndexStore {
  read(): Promise<ArrayBuffer | null>;
  write(buf: ArrayBuffer): Promise<void>;
  /** The journal file beside this index, where a store has one. */
  journal?(): IndexStore;
}
