import * as vscode from 'vscode';
import { setMaxListeners } from 'node:events';
import { createHash } from 'node:crypto';
import { ActivityBucket, BucketThresholds, classifySession, detectActiveProcessRoots, stripNativeMarker } from './model';
import { readProcessIdentity, readProcessSamples, readTerminalDeviceMtimes } from './processes';
import { RefreshQueue } from './scheduler';
import { TerminalRenamer } from './renamer';
import { readPersistedActivities, restoreActivity } from './state';
import { ApplicationTitleReader } from './titles';

interface TerminalActivity {
  terminal: vscode.Terminal;
  baseName: string;
  lastActivity: number;
  lastActivityNotification: number;
  observed: boolean;
  processId?: number;
  identity?: string;
  existingAtActivation: boolean;
  lastAppliedNativeName?: string;
  pendingNativeName?: string;
  retryAfter: number;
  failures: number;
  applicationTitle?: string;
  titleReader?: ApplicationTitleReader;
}

const STORAGE_KEY = 'terminalActivityDashboard.activities.v7';
const NATIVE_BUCKET_PREFIXES: Record<ActivityBucket, string> = { active: '🟢', recent: '🟡', parked: '⚪' };
const processReader = { readProcessIdentity, readProcessSamples, readTerminalDeviceMtimes };
const nameHash = (name: string) => createHash('sha256').update(name).digest('hex');

export class TerminalActivityTracker implements vscode.Disposable {
  private readonly activities = new Map<vscode.Terminal, TerminalActivity>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly abort = new AbortController();
  private readonly persisted;
  private refreshTimer?: NodeJS.Timeout;
  private persistTimer?: NodeJS.Timeout;
  private disposed = false;
  private polling = false;
  private previousCpuByProcessId = new Map<number, number>();
  private previousTerminalMtimeByProcessId = new Map<number, number>();
  private readonly skipNextTerminalDeviceSample = new Set<number>();
  private readonly renamer = new TerminalRenamer<vscode.Terminal>({
    active: () => vscode.window.activeTerminal,
    exists: (terminal) => this.activities.has(terminal),
    rename: (name) => vscode.commands.executeCommand('workbench.action.terminal.renameWithArg', { name }),
    wait: () => new Promise((resolve) => setTimeout(resolve, 25)),
  });
  private readonly queue = new RefreshQueue((kind) => this.applyNativeNameMarkers(kind));
  private readonly persistence = new RefreshQueue(async () => {
    const entries = [...this.activities.values()]
      .filter((activity) => activity.identity !== undefined)
      .map((activity) => ({ identity: activity.identity!, lastActivity: activity.lastActivity,
        ...(activity.lastAppliedNativeName !== undefined && activity.baseName.length <= 4096
          ? { baseName: activity.baseName, markedNameHash: nameHash(activity.lastAppliedNativeName) } : {}),
      }));
    await this.context.workspaceState.update(STORAGE_KEY, entries);
  });

  constructor(private readonly context: vscode.ExtensionContext, private readonly processes = processReader) {
    // Each tracked output stream and subprocess removes its own abort listener.
    setMaxListeners(0, this.abort.signal);
    this.persisted = readPersistedActivities(context.workspaceState.get(STORAGE_KEY), Date.now());
    for (const terminal of vscode.window.terminals) void this.trackTerminal(terminal, true);
    this.disposables.push(
      vscode.window.onDidOpenTerminal((terminal) => { void this.trackTerminal(terminal, false); }),
      vscode.window.onDidCloseTerminal((terminal) => {
        const pid = this.activities.get(terminal)?.processId;
        this.activities.delete(terminal);
        if (pid !== undefined) {
          this.previousTerminalMtimeByProcessId.delete(pid);
          this.skipNextTerminalDeviceSample.delete(pid);
        }
        this.schedulePersist();
      }),
      vscode.window.onDidChangeActiveTerminal((terminal) => {
        this.renamer.selectionChanged(terminal);
        if (terminal) this.requestRefresh();
      }),
      vscode.window.onDidChangeTerminalShellIntegration(() => this.requestRefresh()),
      vscode.window.onDidStartTerminalShellExecution((event) => {
        const activity = this.activities.get(event.terminal);
        if (!activity) return;
        this.recordActivity(activity, true);
        try { void this.monitorExecutionOutput(activity, event.execution.read()); } catch { /* Stream unavailable. */ }
      }),
      vscode.window.onDidEndTerminalShellExecution((event) => {
        const activity = this.activities.get(event.terminal);
        if (activity) this.recordActivity(activity, true);
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('terminalActivityDashboard')) {
          this.startRefreshTimer();
          this.requestRefresh();
        }
      }),
    );
    this.startRefreshTimer();
  }

  refreshNativeNames(): Promise<void> { return this.queue.request('manual'); }

  async clearNativeNameMarkers(): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('terminalActivityDashboard');
    const inspection = configuration.inspect<boolean>('nativeNameMarkers');
    const target = inspection?.workspaceValue !== undefined
      ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    await configuration.update('nativeNameMarkers', false, target);
    await this.queue.request('clear');
  }

  dispose(): void {
    if (this.disposed) return;
    // Submit a final snapshot before shutting down the persistence queue.
    if (this.persistTimer) clearTimeout(this.persistTimer);
    void this.persistence.request('automatic').catch(() => {}).finally(() => this.persistence.dispose());
    this.disposed = true;
    this.abort.abort();
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.queue.dispose();
    this.renamer.dispose();
    for (const disposable of this.disposables) disposable.dispose();
  }

  private async trackTerminal(terminal: vscode.Terminal, existingAtActivation: boolean): Promise<void> {
    const initialName = terminal.name;
    const activity: TerminalActivity = {
      terminal, baseName: stripNativeMarker(terminal.name),
      lastActivity: Date.now() - (existingAtActivation ? this.thresholds().parkedAfterHours * 3_600_000 : 0),
      lastActivityNotification: 0, observed: false, existingAtActivation, retryAfter: 0, failures: 0,
    };
    this.activities.set(terminal, activity);
    this.requestRefresh();
    try {
      const processId = await terminal.processId;
      if (this.disposed || processId === undefined || !this.activities.has(terminal)) return;
      activity.processId = processId;
      const identity = await this.processes.readProcessIdentity(processId, this.abort.signal);
      if (this.disposed || !this.activities.has(terminal)) return;
      activity.identity = identity;
      const saved = this.persisted.get(identity);
      if (existingAtActivation && saved?.baseName !== undefined && saved.markedNameHash === nameHash(initialName)
        && (terminal.name === initialName || terminal.name === activity.lastAppliedNativeName
          || terminal.name === activity.pendingNativeName)) {
        // Recover our own label only after verifying its fingerprint; never split a user's name by guesswork.
        activity.baseName = saved.baseName;
        const unmarked = stripNativeMarker(initialName);
        const prefix = `${saved.baseName} · `;
        if (activity.applicationTitle === undefined && unmarked.startsWith(prefix)) activity.applicationTitle = unmarked.slice(prefix.length);
        activity.lastAppliedNativeName = terminal.name;
      }
      activity.lastActivity = restoreActivity(activity.lastActivity, activity.observed,
        existingAtActivation, this.persisted.get(identity)?.lastActivity);
      this.requestRefresh();
      this.schedulePersist();
    } catch { /* Missing identity disables restoration, not activity tracking. */ }
  }

  private thresholds(): BucketThresholds {
    const configuration = vscode.workspace.getConfiguration('terminalActivityDashboard');
    const activeAfterHours = configuration.get<number>('activeAfterHours', 1);
    return { activeAfterHours, parkedAfterHours: Math.max(activeAfterHours, configuration.get<number>('parkedAfterHours', 24)) };
  }

  private startRefreshTimer(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    const seconds = vscode.workspace.getConfiguration('terminalActivityDashboard').get<number>('refreshIntervalSeconds', 5);
    this.refreshTimer = setInterval(() => { void this.refreshProcessActivity(); }, Math.max(5, seconds) * 1000);
  }

  private async refreshProcessActivity(): Promise<void> {
    if (this.disposed || this.polling) return;
    const roots = [...this.activities.values()].flatMap((activity) => activity.processId === undefined ? [] : [activity.processId]);
    if (roots.length === 0) { this.requestRefresh(); return; }
    this.polling = true;
    try {
      // Either fallback remains useful when the other is unavailable.
      const [cpu, devices] = await Promise.allSettled([
        this.processes.readProcessSamples(this.abort.signal), this.processes.readTerminalDeviceMtimes(roots, this.abort.signal),
      ]);
      if (this.disposed) return;
      const activeRoots = cpu.status === 'fulfilled'
        ? detectActiveProcessRoots(roots, this.previousCpuByProcessId, cpu.value, 0.5) : new Set<number>();
      if (cpu.status === 'fulfilled') this.previousCpuByProcessId = new Map(cpu.value.map((sample) => [sample.processId, sample.cpuSeconds]));
      if (devices.status === 'fulfilled') {
        for (const [pid, mtime] of devices.value) {
          const previous = this.previousTerminalMtimeByProcessId.get(pid);
          if (this.skipNextTerminalDeviceSample.delete(pid)) continue;
          if (previous !== undefined && mtime > previous) activeRoots.add(pid);
        }
        this.previousTerminalMtimeByProcessId = devices.value;
      }
      for (const activity of this.activities.values()) {
        if (activity.processId !== undefined && activeRoots.has(activity.processId)) this.recordActivity(activity);
      }
      this.requestRefresh();
    } finally { this.polling = false; }
  }

  private recordActivity(activity: TerminalActivity, force = false): void {
    if (this.disposed || !this.activities.has(activity.terminal)) return;
    activity.observed = true;
    activity.lastActivity = Date.now();
    if (!force && activity.lastActivity - activity.lastActivityNotification < 1_000) return;
    activity.lastActivityNotification = activity.lastActivity;
    this.requestRefresh();
    this.schedulePersist();
  }

  private async monitorExecutionOutput(activity: TerminalActivity, output: AsyncIterable<string>): Promise<void> {
    // Each execution has its own parser so an incomplete title cannot leak into the next command.
    const titleReader = new ApplicationTitleReader();
    activity.titleReader = titleReader;
    const iterator = output[Symbol.asyncIterator]();
    let stop: (() => void) | undefined;
    const cancel = () => stop?.();
    this.abort.signal.addEventListener('abort', cancel, { once: true });
    const closed = vscode.window.onDidCloseTerminal((terminal) => { if (terminal === activity.terminal) cancel(); });
    try {
      while (!this.disposed && this.activities.has(activity.terminal)) {
        const stopped = new Promise<IteratorResult<string>>((resolve) => {
          stop = () => resolve({ done: true, value: undefined });
        });
        const next = await Promise.race([iterator.next(), stopped]);
        stop?.();
        if (next.done || this.disposed || !this.activities.has(activity.terminal)) break;
        if (activity.titleReader === titleReader) {
          const title = titleReader.read(next.value);
          if (title !== undefined && title !== activity.applicationTitle) {
            activity.applicationTitle = title;
            this.requestRefresh();
          }
        }
        this.recordActivity(activity);
      }
    } catch { /* Stream unavailable. */ }
    finally {
      this.abort.signal.removeEventListener('abort', cancel);
      closed.dispose();
      // Do not block shutdown on an iterator waiting for shell output.
      void Promise.resolve().then(() => iterator.return?.()).catch(() => {});
    }
  }

  private requestRefresh(): void {
    if (!this.disposed) void this.queue.request('automatic').catch(() => {});
  }

  private async applyNativeNameMarkers(kind: 'automatic' | 'manual' | 'clear'): Promise<void> {
    const clear = kind === 'clear';
    const explicit = kind !== 'automatic';
    const enabled = () => !this.disposed && (clear || vscode.workspace.getConfiguration('terminalActivityDashboard').get<boolean>('nativeNameMarkers', true));
    const renameExisting = clear || vscode.workspace.getConfiguration('terminalActivityDashboard').get<boolean>('renameExistingTerminals', true);
    let failures = 0;
    await this.renamer.apply([...this.activities.keys()], (terminal) => {
      const activity = this.activities.get(terminal)!;
      if ((!renameExisting && activity.existingAtActivation) || (!explicit && activity.retryAfter > Date.now())) return;
      if (terminal.name !== activity.lastAppliedNativeName) activity.baseName = stripNativeMarker(terminal.name);
      const showTitles = vscode.workspace.getConfiguration('terminalActivityDashboard').get<boolean>('applicationTitles', true);
      const title = showTitles && activity.applicationTitle && activity.applicationTitle !== activity.baseName
        ? ` · ${activity.applicationTitle}` : '';
      activity.pendingNativeName = clear ? activity.baseName : `${NATIVE_BUCKET_PREFIXES[classifySession(activity, Date.now(), this.thresholds())]} ${activity.baseName}${title}`;
      return activity.pendingNativeName;
    }, explicit, enabled, (terminal, success) => {
      const activity = this.activities.get(terminal)!;
      if (success) {
        activity.lastAppliedNativeName = terminal.name;
        activity.failures = 0;
        activity.retryAfter = 0;
        this.schedulePersist();
        if (activity.processId !== undefined) this.skipNextTerminalDeviceSample.add(activity.processId);
      } else {
        failures += 1;
        activity.failures += 1;
        activity.retryAfter = Date.now() + Math.min(300_000, 5_000 * 2 ** Math.min(activity.failures, 6));
      }
    });
    if (explicit && failures > 0 && !this.disposed) {
      void vscode.window.showWarningMessage(`Terminal Activity Monitor could not rename ${failures} terminal(s). Focus the Terminal panel and try the command again.`);
    }
  }

  private schedulePersist(): void {
    if (this.disposed || this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      void this.persistence.request('automatic').catch(() => {});
    }, 1_000);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const tracker = new TerminalActivityTracker(context);
  context.subscriptions.push(tracker,
    vscode.commands.registerCommand('terminalActivityDashboard.refresh', () => tracker.refreshNativeNames()),
    vscode.commands.registerCommand('terminalActivityDashboard.refreshNativeNames', () => tracker.refreshNativeNames()),
    vscode.commands.registerCommand('terminalActivityDashboard.clearNativeNames', () => tracker.clearNativeNameMarkers()),
  );
}
