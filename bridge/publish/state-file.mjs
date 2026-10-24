/**
 * The bridge's own records on the host: what it published (`manifest.json`)
 * and which links it shared (`shares.json`).
 *
 * They say what the bridge may delete and what it may overwrite, so one that
 * does not read stops the work rather than being read as empty or trimmed to
 * what checks. Read as empty, the bridge forgot every file it wrote; trimmed,
 * it forgot the ones whose entry was damaged. Either way the files stayed on
 * the host, nobody's, until a person found them. A file that is not there at
 * all is a first publish, and is still read as one.
 */
export class StateFileError extends Error {
  constructor(file, reason) {
    super(
      `${file} on the host does not read: ${reason}. Nothing was changed. Correct the file, or ` +
        `remove it to start over, after which the bridge treats every file it finds as not its own.`
    );
    this.file = file;
  }
}
