import { App, Modal, Setting } from "obsidian";
import { t } from "../i18n";
import type { VaultTask } from "../services/task-inventory";

/**
 * Choosing what goes into a block.
 *
 * The list is the project's open tasks, deadline first: batching means
 * deciding what this hour is for, and a list sorted by what is most pressing
 * makes that decision without a person having to sort it themselves. Each
 * task can also be marked for Reminders, because a few of them are worth
 * carrying out of the vault and most are not.
 */
export interface BlockDraft {
  title: string;
  start: Date;
  end: Date;
  calendar: string;
  tasks: VaultTask[];
  remind: VaultTask[];
}

export class BlockComposer extends Modal {
  private readonly chosen = new Set<VaultTask>();
  private readonly reminding = new Set<VaultTask>();
  private title: string;
  private startValue: string;
  private minutes: number;

  constructor(
    app: App,
    private readonly tag: string,
    private readonly candidates: readonly VaultTask[],
    private readonly calendar: string,
    start: Date,
    lengthMinutes: number,
    title: string,
    private readonly capacity: number,
    private readonly onConfirm: (draft: BlockDraft) => void
  ) {
    super(app);
    this.title = title;
    this.startValue = localInput(start);
    this.minutes = lengthMinutes;
    for (const task of candidates.slice(0, capacity)) this.chosen.add(task);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: t().planner.composeTitle(`#${this.tag}`) });

    new Setting(contentEl).setName(t().planner.blockTitle).addText((text) =>
      text.setValue(this.title).onChange((value) => {
        this.title = value;
      })
    );

    new Setting(contentEl).setName(t().planner.blockStart).addText((text) => {
      text.inputEl.type = "datetime-local";
      text.setValue(this.startValue).onChange((value) => {
        this.startValue = value;
      });
    });

    new Setting(contentEl).setName(t().planner.blockLength).addText((text) => {
      text.inputEl.type = "number";
      text.setValue(String(this.minutes)).onChange((value) => {
        this.minutes = Number(value) || this.minutes;
      });
    });

    contentEl.createEl("p", {
      cls: "schreibstube-planner-hint",
      text: t().planner.composeHint(this.capacity)
    });

    const list = contentEl.createDiv({ cls: "schreibstube-planner-picks" });
    if (this.candidates.length === 0) {
      list.createEl("p", { text: t().planner.noOpenTasks });
    }
    for (const task of this.candidates) this.row(list, task);

    new Setting(contentEl)
      .addButton((button) => button.setButtonText(t().common.cancel).onClick(() => this.close()))
      .addButton((button) =>
        button
          .setButtonText(t().planner.composeConfirm)
          .setCta()
          .onClick(() => {
            const start = new Date(this.startValue);
            if (Number.isNaN(start.getTime())) return;
            this.onConfirm({
              title: this.title.trim() || this.tag,
              start,
              end: new Date(start.getTime() + Math.max(5, this.minutes) * 60_000),
              calendar: this.calendar,
              tasks: [...this.chosen],
              remind: [...this.reminding].filter((task) => this.chosen.has(task))
            });
            this.close();
          })
      );
  }

  private row(list: HTMLElement, task: VaultTask): void {
    const row = list.createDiv({ cls: "schreibstube-planner-pick" });

    const box = row.createEl("input", { type: "checkbox" });
    box.checked = this.chosen.has(task);
    box.addEventListener("change", () => {
      if (box.checked) this.chosen.add(task);
      else this.chosen.delete(task);
    });

    const label = row.createDiv({ cls: "schreibstube-planner-pick-text" });
    label.createSpan({ text: task.text });
    const meta = label.createDiv({ cls: "schreibstube-planner-pick-meta" });
    meta.createSpan({ text: noteName(task.path) });
    if (task.due) meta.createSpan({ cls: "is-due", text: task.due });

    const remind = row.createEl("label", { cls: "schreibstube-planner-remind" });
    const remindBox = remind.createEl("input", { type: "checkbox" });
    remind.createSpan({ text: t().planner.alsoRemind });
    remindBox.addEventListener("change", () => {
      if (remindBox.checked) this.reminding.add(task);
      else this.reminding.delete(task);
    });
  }
}

/** Setting a project's deadline: one date, and how many of its tasks fit an hour. */
export class DeadlineModal extends Modal {
  private date: string;
  private capacity: number;

  constructor(
    app: App,
    private readonly tag: string,
    date: string | null,
    capacity: number,
    private readonly onConfirm: (date: string | null, capacity: number) => void
  ) {
    super(app);
    this.date = date ?? "";
    this.capacity = capacity;
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: t().planner.deadlineTitle(`#${this.tag}`) });

    new Setting(contentEl).setName(t().planner.deadlineDate).addText((text) => {
      text.inputEl.type = "date";
      text.setValue(this.date).onChange((value) => {
        this.date = value;
      });
    });

    new Setting(contentEl)
      .setName(t().planner.deadlineCapacity)
      .setDesc(t().planner.deadlineCapacityDesc)
      .addText((text) => {
        text.inputEl.type = "number";
        text.setValue(String(this.capacity)).onChange((value) => {
          this.capacity = Number(value) || this.capacity;
        });
      });

    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText(t().planner.deadlineClear).onClick(() => {
          this.onConfirm(null, this.capacity);
          this.close();
        })
      )
      .addButton((button) =>
        button
          .setButtonText(t().common.save)
          .setCta()
          .onClick(() => {
            this.onConfirm(/^\d{4}-\d{2}-\d{2}$/.test(this.date) ? this.date : null, this.capacity);
            this.close();
          })
      );
  }
}

function localInput(moment: Date): string {
  const pad = (value: number) => `${value}`.padStart(2, "0");
  return (
    `${moment.getFullYear()}-${pad(moment.getMonth() + 1)}-${pad(moment.getDate())}` +
    `T${pad(moment.getHours())}:${pad(moment.getMinutes())}`
  );
}

function noteName(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.md$/, "");
}
