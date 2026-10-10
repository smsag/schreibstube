import type { App } from "obsidian";
import {
  type DueMoveTally,
  type LocalDayOf,
  moveDue,
  planDueMove,
  tallyDueMoves
} from "../services/due-date";
import type { Logger } from "../services/logger";

type VaultApp = Pick<App, "vault" | "metadataCache" | "fileManager">;

/** What a run moved, and how many notes it could not write. */
export interface DueMoveResult {
  tally: DueMoveTally;
  failed: number;
}

/**
 * Moving the vault's due days off `schreibstubeDue` onto the property the
 * settings name.
 *
 * Counting reads Obsidian's metadata only, so the settings can show the figure
 * every time they open. Moving decides again inside each write, against the
 * frontmatter as it is then: a note edited since the count is judged by what
 * it says now, and a conflict is never resolved for the person.
 */
export class DueMigration {
  constructor(
    private readonly app: VaultApp,
    private readonly property: () => string,
    private readonly logger: Logger,
    private readonly dayOf?: LocalDayOf
  ) {}

  count(): DueMoveTally {
    const property = this.property();
    return tallyDueMoves(
      this.app.vault.getMarkdownFiles().map((file) => ({
        path: file.path,
        move: planDueMove(
          this.app.metadataCache.getFileCache(file)?.frontmatter,
          property,
          this.dayOf
        )
      }))
    );
  }

  async run(): Promise<DueMoveResult> {
    const property = this.property();
    const done: { path: string; move: ReturnType<typeof moveDue> }[] = [];
    let failed = 0;
    for (const file of this.app.vault.getMarkdownFiles()) {
      const planned = planDueMove(
        this.app.metadataCache.getFileCache(file)?.frontmatter,
        property,
        this.dayOf
      );
      // A conflict stays as it is; writing the file only to leave it alone
      // would still touch its modified time.
      if (planned === "none" || planned === "conflict") {
        done.push({ path: file.path, move: planned });
        continue;
      }
      try {
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
          done.push({ path: file.path, move: moveDue(frontmatter, property, this.dayOf) });
        });
      } catch (error) {
        failed += 1;
        this.logger.warn(`Could not move the due day in ${file.path}:`, error);
      }
    }
    return { tally: tallyDueMoves(done), failed };
  }
}
