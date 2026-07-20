import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import {
  ActivityBucket,
  BucketThresholds,
  classifySession,
  CompletionMarker,
  completionMarkerForExecution,
  detectActiveProcessRoots,
  detectChangedTerminalDevices,
  formatNativeMarker,
  parseProcessSamples,
  parseProcessTerminalDevices,
  stripNativeMarker,
  terminalNeedsReveal,
  terminalToRestoreAfterRename,
} from './model';

interface PersistedActivity {
  processId: number;
  lastActivity: number;
}

interface TerminalActivity {
  terminal: vscode.Terminal;
  baseName: string;
  lastActivity: number;
  lastActivityNotification: number;
  lastLiveActivity?: number;
  unseenCompletion?: CompletionMarker;
  shellExecutionStartedAt?: number;
  processId?: number;
  existingAtActivation: boolean;
  lastAppliedNativeName?: string;
}

const STORAGE_KEY = 'terminalActivityDashboard.activities';
const STORAGE_VERSION_KEY = 'terminalActivityDashboard.activitiesVersion';
const STORAGE_VERSION = 6;
const MINIMUM_CPU_DELTA_SECONDS = 0.5;
const NEW_TERMINAL_ACTIVATION_DELAY_MS = 250;
class TerminalActivityTracker implements vscode.Disposable {
  private readonly activities = new Map<vscode.Terminal, TerminalActivity>();
  private readonly disposables: vscode.Disposable[] = [];
  private persistedByProcessId = new Map<number, PersistedActivity>();
  private refreshTimer?: NodeJS.Timeout;
  private nativeNameRefresh = Promise.resolve();
  private previousCpuByProcessId = new Map<number, number>();
  private previousTerminalMtimeByProcessId = new Map<number, number>();
  private readonly rebaseliningTerminalDeviceProcessIds = new Set<number>();
  private readonly pendingNewTerminals = new Set<vscode.Terminal>();
  private readonly migrateLegacyFocusActivity: boolean;
  private userActiveTerminal = vscode.window.activeTerminal;
  private userActiveSelectionVersion = 0;
  private applyingNativeNames = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    const persisted = context.globalState.get<PersistedActivity[]>(STORAGE_KEY, []);
    this.persistedByProcessId = new Map(persisted.map((entry) => [entry.processId, entry]));

    this.migrateLegacyFocusActivity = context.globalState.get<number>(STORAGE_VERSION_KEY, 1) < STORAGE_VERSION;
    const restoredTerminals = vscode.window.terminals.map((terminal) => this.trackTerminal(terminal, true));

    this.disposables.push(
      vscode.window.onDidOpenTerminal((terminal) => this.deferNewTerminalTracking(terminal)),
      vscode.window.onDidCloseTerminal((terminal) => this.removeTerminal(terminal)),
      vscode.window.onDidChangeActiveTerminal((terminal) => {
        const activatingNewTerminal = terminal !== undefined && this.pendingNewTerminals.has(terminal);
        if (this.applyingNativeNames && !activatingNewTerminal) return;
        this.userActiveTerminal = terminal;
        this.userActiveSelectionVersion += 1;
        if (!terminal) return;
        const activity = this.ensureActivity(terminal);
        void this.rebaselineTerminalDevices(activity.processId === undefined ? [] : [activity.processId]);
        if (activity.unseenCompletion) {
          activity.unseenCompletion = undefined;
          this.refresh('terminal', activity);
        }
      }),
      vscode.window.onDidChangeTerminalShellIntegration((event) => {
        const activity = this.ensureActivity(event.terminal);
        this.refresh('terminal', activity);
      }),
      vscode.window.onDidStartTerminalShellExecution((event) => {
        const activity = this.ensureActivity(event.terminal);
        activity.shellExecutionStartedAt = Date.now();
        activity.unseenCompletion = undefined;
        this.recordActivity(activity, { forceNotification: true, markLive: true });
        try {
          const output = event.execution.read();
          void this.monitorExecutionOutput(activity, output);
        } catch {
          // Some shell integrations cannot stream execution output.
        }
      }),
      vscode.window.onDidEndTerminalShellExecution((event) => {
        const activity = this.ensureActivity(event.terminal);
        const endedAt = Date.now();
        const startedAt = activity.shellExecutionStartedAt;
        activity.shellExecutionStartedAt = undefined;
        activity.lastLiveActivity = undefined;
        const configuration = vscode.workspace.getConfiguration('terminalActivityDashboard');
        activity.unseenCompletion = configuration.get<boolean>('completionMarkers', true) && startedAt !== undefined
          ? completionMarkerForExecution(
              event.exitCode,
              endedAt - startedAt,
              configuration.get<number>('completionMinimumSeconds', 10),
              this.userActiveTerminal === event.terminal,
            )
          : undefined;
        this.recordActivity(activity, { forceNotification: true, markLive: false });
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('terminalActivityDashboard')) {
          if (!vscode.workspace.getConfiguration('terminalActivityDashboard').get<boolean>('completionMarkers', true)) {
            for (const activity of this.activities.values()) activity.unseenCompletion = undefined;
          }
          this.startRefreshTimer();
          this.refresh(true);
        }
      }),
    );

    this.startRefreshTimer();
    void Promise.all(restoredTerminals).then(() => {
      void this.context.globalState.update(STORAGE_VERSION_KEY, STORAGE_VERSION);
      void this.refreshProcessActivity();
    });
  }

  refresh(syncNativeNames: boolean | 'terminal' = false, targetActivity?: TerminalActivity): void {
    if (targetActivity && this.pendingNewTerminals.has(targetActivity.terminal)) return;
    if (syncNativeNames) {
      this.queueNativeNameRefresh(syncNativeNames === 'terminal' ? targetActivity : undefined);
    }
  }

  async refreshNativeNames(): Promise<void> {
    this.nativeNameRefresh = this.nativeNameRefresh
      .then(() => this.applyNativeNameMarkers({ clearOnly: false }), () => this.applyNativeNameMarkers({ clearOnly: false }));
    await this.nativeNameRefresh;
  }

  async clearNativeNameMarkers(): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('terminalActivityDashboard');
    const inspection = configuration.inspect<boolean>('nativeNameMarkers');
    const target = inspection?.workspaceFolderValue !== undefined
      ? vscode.ConfigurationTarget.WorkspaceFolder
      : inspection?.workspaceValue !== undefined
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
    await configuration.update('nativeNameMarkers', false, target);
    this.nativeNameRefresh = this.nativeNameRefresh
      .then(() => this.applyNativeNameMarkers({ clearOnly: true }), () => this.applyNativeNameMarkers({ clearOnly: true }));
    await this.nativeNameRefresh;
  }

  dispose(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    for (const disposable of this.disposables) disposable.dispose();
  }

  private trackTerminal(terminal: vscode.Terminal, existingAtActivation: boolean): Promise<void> {
    const activity = this.ensureActivity(terminal, existingAtActivation);
    const processIdReady = Promise.resolve(terminal.processId).then((processId) => {
      if (processId === undefined || !this.activities.has(terminal)) return;
      activity.processId = processId;
      const persisted = this.persistedByProcessId.get(processId);
      if (persisted) {
        activity.lastActivity = this.restoredLastActivity(persisted.lastActivity, activity);
      }
      this.refresh('terminal', activity);
      void this.persist();
    });
    this.refresh('terminal', activity);
    return processIdReady;
  }

  private ensureActivity(terminal: vscode.Terminal, existingAtActivation = false): TerminalActivity {
    let activity = this.activities.get(terminal);
    if (!activity) {
      activity = {
        terminal,
        baseName: stripNativeMarker(terminal.name),
        lastActivity: this.initialLastActivity(existingAtActivation),
        lastActivityNotification: 0,
        existingAtActivation,
      };
      this.activities.set(terminal, activity);
    } else if (terminal.name !== activity.lastAppliedNativeName) {
      activity.baseName = stripNativeMarker(terminal.name);
    }
    return activity;
  }

  private removeTerminal(terminal: vscode.Terminal): void {
    this.pendingNewTerminals.delete(terminal);
    this.activities.delete(terminal);
    this.refresh(false);
    void this.persist();
  }

  private deferNewTerminalTracking(terminal: vscode.Terminal): void {
    this.pendingNewTerminals.add(terminal);
    setTimeout(() => {
      if (!this.pendingNewTerminals.delete(terminal) || !vscode.window.terminals.includes(terminal)) return;
      if (vscode.window.activeTerminal === terminal && this.userActiveTerminal !== terminal) {
        this.userActiveTerminal = terminal;
        this.userActiveSelectionVersion += 1;
      }
      void this.trackTerminal(terminal, false);
    }, NEW_TERMINAL_ACTIVATION_DELAY_MS);
  }

  private thresholds(): BucketThresholds {
    const configuration = vscode.workspace.getConfiguration('terminalActivityDashboard');
    const activeAfterHours = configuration.get<number>('activeAfterHours', 1);
    const configuredParked = configuration.get<number>('parkedAfterHours', 24);
    const parkedAfterHours = Math.max(configuredParked, activeAfterHours);
    const configuredStale = configuration.get<number>('staleAfterHours', 168);
    return {
      activeAfterHours,
      parkedAfterHours,
      staleAfterHours: Math.max(configuredStale, parkedAfterHours),
    };
  }

  private initialLastActivity(existingAtActivation: boolean): number {
    if (!existingAtActivation) return Date.now();
    const parkedAfterMs = this.thresholds().parkedAfterHours * 3_600_000;
    return Date.now() - parkedAfterMs;
  }

  private restoredLastActivity(persistedLastActivity: number, activity: TerminalActivity): number {
    if (!this.migrateLegacyFocusActivity || !activity.existingAtActivation) return persistedLastActivity;
    return Math.min(persistedLastActivity, this.initialLastActivity(true));
  }

  private startRefreshTimer(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    const seconds = vscode.workspace
      .getConfiguration('terminalActivityDashboard')
      .get<number>('refreshIntervalSeconds', 30);
    this.refreshTimer = setInterval(() => { void this.refreshProcessActivity(); }, Math.max(5, seconds) * 1000);
  }

  private async refreshProcessActivity(): Promise<void> {
    const internalFocusInProgress = this.applyingNativeNames;
    try {
      const samples = await readProcessSamples();
      const rootProcessIds = [...this.activities.values()]
        .map((activity) => activity.processId)
        .filter((processId): processId is number => processId !== undefined);
      const activeRoots = detectActiveProcessRoots(
        rootProcessIds,
        this.previousCpuByProcessId,
        samples,
        MINIMUM_CPU_DELTA_SECONDS,
      );
      const terminalMtimes = await readTerminalDeviceMtimes(rootProcessIds);
      const changedTerminalDevices = detectChangedTerminalDevices(
        this.previousTerminalMtimeByProcessId,
        terminalMtimes,
      );
      for (const processId of changedTerminalDevices) activeRoots.add(processId);
      const suppressInternalFocusActivity = internalFocusInProgress || this.applyingNativeNames;
      for (const activity of this.activities.values()) {
        if (
          activity.processId !== undefined
          && activeRoots.has(activity.processId)
          && !suppressInternalFocusActivity
          && !this.rebaseliningTerminalDeviceProcessIds.has(activity.processId)
        ) {
          this.recordActivity(activity, { markLive: true });
        }
      }
      this.previousCpuByProcessId = new Map(samples.map((sample) => [sample.processId, sample.cpuSeconds]));
      this.previousTerminalMtimeByProcessId = terminalMtimes;
    } catch {
      // Shell integration events remain available when process inspection is unsupported.
    }
    this.refresh(true);
  }

  private recordActivity(
    activity: TerminalActivity,
    options: { forceNotification?: boolean; markLive?: boolean } = {},
  ): void {
    const now = Date.now();
    activity.lastActivity = now;
    if (options.markLive !== false) activity.lastLiveActivity = now;
    if (!options.forceNotification && now - activity.lastActivityNotification < 1_000) return;
    activity.lastActivityNotification = now;
    this.refresh('terminal', activity);
    void this.persist();
  }

  private async monitorExecutionOutput(activity: TerminalActivity, output: AsyncIterable<string>): Promise<void> {
    try {
      for await (const _chunk of output) {
        if (!this.activities.has(activity.terminal)) return;
        this.recordActivity(activity);
      }
    } catch {
      // Some shell integrations cannot stream execution output.
    }
  }

  private queueNativeNameRefresh(targetActivity?: TerminalActivity): void {
    const enabled = vscode.workspace
      .getConfiguration('terminalActivityDashboard')
      .get<boolean>('nativeNameMarkers', true);
    if (!enabled) return;

    this.nativeNameRefresh = this.nativeNameRefresh
      .then(
        () => this.applyNativeNameMarkers({ clearOnly: false, targetActivity }),
        () => this.applyNativeNameMarkers({ clearOnly: false, targetActivity }),
      );
  }

  private async applyNativeNameMarkers(options: { clearOnly: boolean; targetActivity?: TerminalActivity }): Promise<void> {
    const { clearOnly, targetActivity } = options;
    const configuration = vscode.workspace.getConfiguration('terminalActivityDashboard');
    if (!clearOnly && !configuration.get<boolean>('nativeNameMarkers', true)) return;

    this.applyingNativeNames = true;
    try {
      const renameExistingTerminals = clearOnly
        ? true
        : configuration.get<boolean>('renameExistingTerminals', true);
      const activeTerminal = vscode.window.activeTerminal;
      const selectionVersionAtStart = this.userActiveSelectionVersion;
      const now = Date.now();
      const thresholds = this.thresholds();
      const liveIndicatorSeconds = configuration.get<number>('liveIndicatorSeconds', 15);
      const completionMarkers = configuration.get<boolean>('completionMarkers', true);
      const activities = targetActivity ? [targetActivity] : [...this.activities.values()];
      const failedNames: string[] = [];

      for (const activity of activities) {
        if (!this.activities.has(activity.terminal)) continue;
        if (this.pendingNewTerminals.has(activity.terminal)) continue;
        if (activity.existingAtActivation && !renameExistingTerminals) continue;
        const bucket = this.displayBucket(this.classifyActivity(activity, now, thresholds));
        const baseName = clearOnly ? stripNativeMarker(activity.terminal.name) : activity.baseName;
        const marker = formatNativeMarker(
          {
            bucket,
            lastLiveActivity: activity.lastLiveActivity,
            unseenCompletion: completionMarkers ? activity.unseenCompletion : undefined,
          },
          now,
          liveIndicatorSeconds,
        );
        const targetName = clearOnly ? baseName : `${marker} ${baseName}`;
        if (activity.terminal.name === targetName) {
          activity.lastAppliedNativeName = targetName;
          activity.baseName = baseName;
          continue;
        }

        const renamed = await this.renameTerminal(activity.terminal, targetName);
        if (renamed) {
          activity.lastAppliedNativeName = targetName;
          activity.baseName = baseName;
        } else {
          failedNames.push(activity.terminal.name);
        }
      }

      const terminalToRestore = terminalToRestoreAfterRename(
        activeTerminal,
        this.userActiveTerminal,
        selectionVersionAtStart,
        this.userActiveSelectionVersion,
      );
      if (
        terminalToRestore
        && vscode.window.terminals.includes(terminalToRestore)
        && terminalNeedsReveal(vscode.window.activeTerminal, terminalToRestore)
      ) {
        await this.showTerminalForRename(terminalToRestore);
      }
      if (failedNames.length > 0) {
        void vscode.window.showWarningMessage(
          `Terminal Activity Monitor could not rename ${failedNames.length} terminal${failedNames.length === 1 ? '' : 's'}. Try the command again after focusing the Terminal panel.`,
        );
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    } finally {
      await this.rebaselineTerminalDevices(
        [...this.activities.values()]
          .map((activity) => activity.processId)
          .filter((processId): processId is number => processId !== undefined),
      );
      this.applyingNativeNames = false;
    }
  }

  private async showTerminalForRename(terminal: vscode.Terminal): Promise<void> {
    if (!terminalNeedsReveal(vscode.window.activeTerminal, terminal)) return;
    terminal.show(false);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (vscode.window.activeTerminal === terminal) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
  }

  private async rebaselineTerminalDevices(processIds: number[]): Promise<void> {
    if (processIds.length === 0 || process.platform === 'win32') return;
    for (const processId of processIds) this.rebaseliningTerminalDeviceProcessIds.add(processId);
    try {
      const mtimes = await readTerminalDeviceMtimes(processIds);
      for (const [processId, mtimeMs] of mtimes) {
        this.previousTerminalMtimeByProcessId.set(processId, mtimeMs);
      }
    } catch {
      // A terminal may close while its post-focus device timestamp is sampled.
    } finally {
      for (const processId of processIds) this.rebaseliningTerminalDeviceProcessIds.delete(processId);
    }
  }

  private async renameTerminal(terminal: vscode.Terminal, targetName: string): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.showTerminalForRename(terminal);
      if (vscode.window.activeTerminal !== terminal) continue;
      await vscode.commands.executeCommand('workbench.action.terminal.renameWithArg', { name: targetName });
      for (let wait = 0; wait < 20; wait += 1) {
        if (terminal.name === targetName) return true;
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
      }
    }
    return terminal.name === targetName;
  }

  private classifyActivity(activity: TerminalActivity, now: number, thresholds: BucketThresholds): ActivityBucket {
    return classifySession(
      { lastActivity: activity.lastActivity },
      now,
      thresholds,
    );
  }

  private displayBucket(bucket: ActivityBucket): ActivityBucket {
    return bucket === 'stale' ? 'parked' : bucket;
  }

  private async persist(): Promise<void> {
    const entries = [...this.activities.values()]
      .filter((activity): activity is TerminalActivity & { processId: number } => activity.processId !== undefined)
      .map((activity) => ({
        processId: activity.processId,
        lastActivity: activity.lastActivity,
      }));
    await this.context.globalState.update(STORAGE_KEY, entries);
  }

}

export function activate(context: vscode.ExtensionContext): void {
  const tracker = new TerminalActivityTracker(context);

  context.subscriptions.push(
    tracker,
    vscode.commands.registerCommand('terminalActivityDashboard.refresh', () => tracker.refreshNativeNames()),
    vscode.commands.registerCommand('terminalActivityDashboard.refreshNativeNames', () => tracker.refreshNativeNames()),
    vscode.commands.registerCommand('terminalActivityDashboard.clearNativeNames', () => tracker.clearNativeNameMarkers()),
  );
}

export function deactivate(): void {}

async function readProcessSamples() {
  const windows = process.platform === 'win32';
  const output = windows
    ? await executeProcess('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.KernelModeTime + $_.UserModeTime)" }',
      ])
    : await executeProcess('ps', ['-axo', 'pid=,ppid=,time=']);
  return parseProcessSamples(output, windows);
}

async function readTerminalDeviceMtimes(rootProcessIds: number[]): Promise<Map<number, number>> {
  if (process.platform === 'win32' || rootProcessIds.length === 0) return new Map();
  const output = await executeProcess('ps', [
    '-p',
    rootProcessIds.join(','),
    '-o',
    'pid=,tty=',
  ]);
  const devices = parseProcessTerminalDevices(output);
  const mtimes = new Map<number, number>();
  await Promise.all([...devices].map(async ([processId, device]) => {
    try {
      const details = await stat(`/dev/${device}`);
      mtimes.set(processId, details.mtimeMs);
    } catch {
      // The terminal may have closed between process listing and stat.
    }
  }));
  return mtimes;
}

function executeProcess(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}
