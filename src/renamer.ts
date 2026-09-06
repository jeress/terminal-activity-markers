export interface NamedTerminal {
  readonly name: string;
  show(preserveFocus?: boolean): void;
}

export interface RenameHost<T extends NamedTerminal> {
  active(): T | undefined;
  exists(terminal: T): boolean;
  rename(name: string): PromiseLike<unknown>;
  wait(): Promise<void>;
}

/** Owns selection changes only for an explicit full refresh. */
export class TerminalRenamer<T extends NamedTerminal> {
  private disposed = false;
  private interrupted = false;
  private expected?: T;
  private switching = false;
  private lastSelected?: T;

  constructor(private readonly host: RenameHost<T>) {}

  selectionChanged(terminal: T | undefined): void {
    if (this.switching && terminal !== this.expected) this.interrupted = true;
  }

  dispose(): void { this.disposed = true; this.interrupted = true; }

  async apply(
    terminals: readonly T[],
    targetName: (terminal: T) => string | undefined,
    explicit: boolean,
    enabled: () => boolean,
    result: (terminal: T, success: boolean) => void,
  ): Promise<void> {
    const original = this.host.active();
    this.interrupted = false;
    this.switching = true;
    this.expected = original;
    this.lastSelected = undefined;
    try {
      for (const terminal of terminals) {
        if (this.disposed || this.interrupted || !enabled()) break;
        if (!this.host.exists(terminal) || (!explicit && this.host.active() !== terminal)) continue;
        const name = targetName(terminal);
        if (name === undefined || name === terminal.name) continue;
        const before = terminal.name;
        const selected = await this.select(terminal, explicit);
        if (!enabled() || this.disposed || this.interrupted) break;
        if (!selected) {
          if (this.host.exists(terminal)) result(terminal, false);
          break;
        }
        // A shell or user rename during selection takes precedence.
        if (!this.host.exists(terminal) || terminal.name !== before) continue;
        let success = false;
        try {
          await this.host.rename(name);
          for (let attempt = 0; attempt < 20; attempt += 1) {
            if (this.disposed || this.interrupted || !this.host.exists(terminal) || !enabled()) break;
            if (terminal.name === name) { success = true; break; }
            await this.host.wait();
          }
        } catch {
          // The terminal can disappear while the command is in flight.
        }
        if (!this.disposed && this.host.exists(terminal)) result(terminal, success);
      }
    } finally {
      if (!this.disposed && !this.interrupted && this.lastSelected && original
        && this.host.exists(original) && this.host.active() === this.lastSelected
        && this.host.active() !== original) {
        await this.select(original, true);
      }
      this.switching = false;
      this.expected = undefined;
    }
  }

  private async select(terminal: T, explicit: boolean): Promise<boolean> {
    if (this.host.active() === terminal) return true;
    if (!explicit || this.disposed || this.interrupted || !this.host.exists(terminal)) return false;
    this.expected = terminal;
    this.lastSelected = terminal;
    terminal.show(true);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (this.disposed || this.interrupted || !this.host.exists(terminal)) return false;
      if (this.host.active() === terminal) return true;
      await this.host.wait();
    }
    return false;
  }
}
