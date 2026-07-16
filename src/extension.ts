import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import {
  ActivityBucket,
  BucketThresholds,
  classifySession,
  detectActiveProcessRoots,
  parseProcessSamples,
  stripNativeMarker,
} from './model';

interface PersistedActivity {
  processId: number;
  lastActivity: number;
  lastCommand?: string;
}

interface TerminalActivity {
  terminal: vscode.Terminal;
  baseName: string;
  lastActivity: number;
  lastCommand?: string;
  runningExecutions: number;
  processId?: number;
  existingAtActivation: boolean;
  lastAppliedNativeName?: string;
}

const STORAGE_KEY = 'terminalActivityDashboard.activities';
const STORAGE_VERSION_KEY = 'terminalActivityDashboard.activitiesVersion';
const STORAGE_VERSION = 5;
const MINIMUM_CPU_DELTA_SECONDS = 0.05;
const NATIVE_BUCKET_PREFIXES: Record<ActivityBucket, string> = {
  running: '🟢',
  recent: '🟡',
  parked: '⚪',
  stale: '⚪',
};

class TerminalActivityTracker implements vscode.Disposable {
  private readonly activities = new Map<vscode.Terminal, TerminalActivity>();
  private readonly disposables: vscode.Disposable[] = [];
  private persistedByProcessId = new Map<number, PersistedActivity>();
  private refreshTimer?: NodeJS.Timeout;
  private nativeNameRefresh = Promise.resolve();
  private previousCpuByProcessId = new Map<number, number>();
  private readonly migrateLegacyFocusActivity: boolean;
  private applyingNativeNames = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    const persisted = context.globalState.get<PersistedActivity[]>(STORAGE_KEY, []);
    this.persistedByProcessId = new Map(persisted.map((entry) => [entry.processId, entry]));

    this.migrateLegacyFocusActivity = context.globalState.get<number>(STORAGE_VERSION_KEY, 1) < STORAGE_VERSION;
    const restoredTerminals = vscode.window.terminals.map((terminal) => this.trackTerminal(terminal, true));

    this.disposables.push(
      vscode.window.onDidOpenTerminal((terminal) => { void this.trackTerminal(terminal, false); }),
      vscode.window.onDidCloseTerminal((terminal) => this.removeTerminal(terminal)),
      vscode.window.onDidChangeActiveTerminal((terminal) => {
        if (terminal && !this.applyingNativeNames) this.ensureActivity(terminal);
      }),
      vscode.window.onDidChangeTerminalShellIntegration((event) => {
        const activity = this.ensureActivity(event.terminal);
        this.refresh('terminal', activity);
      }),
      vscode.window.onDidStartTerminalShellExecution((event) => {
        const activity = this.ensureActivity(event.terminal);
        activity.runningExecutions += 1;
        activity.lastActivity = Date.now();
        activity.lastCommand = event.execution.commandLine.value || activity.lastCommand;
        this.refresh('terminal', activity);
        void this.persist();
      }),
      vscode.window.onDidEndTerminalShellExecution((event) => {
        const activity = this.ensureActivity(event.terminal);
        activity.runningExecutions = Math.max(0, activity.runningExecutions - 1);
        activity.lastActivity = Date.now();
        this.refresh('terminal', activity);
        void this.persist();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('terminalActivityDashboard')) {
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
        activity.lastCommand = persisted.lastCommand;
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
        runningExecutions: 0,
        existingAtActivation,
      };
      this.activities.set(terminal, activity);
    } else if (terminal.name !== activity.lastAppliedNativeName) {
      activity.baseName = stripNativeMarker(terminal.name);
    }
    return activity;
  }

  private removeTerminal(terminal: vscode.Terminal): void {
    this.activities.delete(terminal);
    this.refresh(false);
    void this.persist();
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
    const activeAfterMs = this.thresholds().activeAfterHours * 3_600_000;
    return Date.now() - activeAfterMs;
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
      const now = Date.now();
      for (const activity of this.activities.values()) {
        if (activity.processId !== undefined && activeRoots.has(activity.processId)) activity.lastActivity = now;
      }
      this.previousCpuByProcessId = new Map(samples.map((sample) => [sample.processId, sample.cpuSeconds]));
      if (activeRoots.size > 0) await this.persist();
    } catch {
      // Shell integration events remain available when process inspection is unsupported.
    }
    this.refresh(true);
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
      const now = Date.now();
      const thresholds = this.thresholds();
      const activities = targetActivity ? [targetActivity] : [...this.activities.values()];
      const failedNames: string[] = [];

      for (const activity of activities) {
        if (!this.activities.has(activity.terminal)) continue;
        if (activity.existingAtActivation && !renameExistingTerminals) continue;
        const bucket = this.displayBucket(this.classifyActivity(activity, now, thresholds));
        const baseName = clearOnly ? stripNativeMarker(activity.terminal.name) : activity.baseName;
        const targetName = clearOnly ? baseName : `${NATIVE_BUCKET_PREFIXES[bucket]} ${baseName}`;
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

      if (activeTerminal && vscode.window.terminals.includes(activeTerminal)) {
        await this.showTerminalForRename(activeTerminal);
      }
      if (failedNames.length > 0) {
        void vscode.window.showWarningMessage(
          `Terminal Activity Monitor could not rename ${failedNames.length} terminal${failedNames.length === 1 ? '' : 's'}. Try the command again after focusing the Terminal panel.`,
        );
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    } finally {
      this.applyingNativeNames = false;
    }
  }

  private async showTerminalForRename(terminal: vscode.Terminal): Promise<void> {
    terminal.show(false);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (vscode.window.activeTerminal === terminal) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
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
      { running: activity.runningExecutions > 0, lastActivity: activity.lastActivity },
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
        lastCommand: activity.lastCommand,
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

function executeProcess(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}
