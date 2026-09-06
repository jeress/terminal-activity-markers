/** Serializes work, retaining at most one pending request of each kind. */
export class RefreshQueue {
  private readonly pending = new Set<'automatic' | 'manual' | 'clear'>();
  private running?: Promise<void>;
  private disposed = false;

  constructor(private readonly run: (kind: 'automatic' | 'manual' | 'clear') => Promise<void>) {}

  request(kind: 'automatic' | 'manual' | 'clear'): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (kind === 'clear') this.pending.clear();
    if (kind !== 'automatic' || !this.pending.has('clear')) this.pending.add(kind);
    if (!this.running) {
      this.running = Promise.resolve().then(() => this.drain());
    }
    return this.running;
  }

  dispose(): void {
    this.disposed = true;
    this.pending.clear();
  }

  private async drain(): Promise<void> {
    let firstError: unknown;
    while (!this.disposed && this.pending.size > 0) {
      const kind = this.pending.values().next().value!;
      this.pending.delete(kind);
      try { await this.run(kind); } catch (error) { firstError ??= error; }
    }
    this.running = undefined;
    if (firstError !== undefined) throw firstError;
  }
}
