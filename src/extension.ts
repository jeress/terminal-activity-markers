import * as vscode from 'vscode';
import { ActivityBucket, BucketThresholds, classifySession, formatAge } from './model';

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

type DashboardNode = BucketNode | TerminalNode;

const STORAGE_KEY = 'terminalActivityDashboard.activities';
const BUCKET_ORDER: ActivityBucket[] = ['running', 'recent', 'parked'];
const NATIVE_NAME_MARKER = /^(?:[🟢🟡⚪]\s+)?(?:\[[0-9] (?:RUN|WAIT|IDLE|PARK|STALE)\]|Active|Recent|Idle)\s+/u;
const NATIVE_BUCKET_PREFIXES: Record<ActivityBucket, string> = {
  running: '🟢 Active',
  recent: '🟡 Recent',
  parked: '⚪ Idle',
  stale: '⚪ Idle',
};
const BUCKET_LABELS: Record<ActivityBucket, string> = {
  running: 'Active',
  recent: 'Recent',
  parked: 'Idle',
  stale: 'Idle',
};

class BucketNode {
  constructor(
    readonly bucket: ActivityBucket,
    readonly sessions: TerminalActivity[],
  ) {}
}

class TerminalNode {
  constructor(readonly activity: TerminalActivity) {}
}

class TerminalActivityProvider implements vscode.TreeDataProvider<DashboardNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<DashboardNode | undefined | void>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly activities = new Map<vscode.Terminal, TerminalActivity>();
  private readonly disposables: vscode.Disposable[] = [];
  private persistedByProcessId = new Map<number, PersistedActivity>();
  private refreshTimer?: NodeJS.Timeout;
  private treeView?: vscode.TreeView<DashboardNode>;
  private nativeNameRefresh = Promise.resolve();

  constructor(private readonly context: vscode.ExtensionContext) {
    const persisted = context.globalState.get<PersistedActivity[]>(STORAGE_KEY, []);
    this.persistedByProcessId = new Map(persisted.map((entry) => [entry.processId, entry]));

    for (const terminal of vscode.window.terminals) {
      this.trackTerminal(terminal, true);
    }

    this.disposables.push(
      vscode.window.onDidOpenTerminal((terminal) => this.trackTerminal(terminal, false)),
      vscode.window.onDidCloseTerminal((terminal) => this.removeTerminal(terminal)),
      vscode.window.onDidChangeActiveTerminal((terminal) => {
        if (terminal) this.touch(terminal, true, 'terminal');
      }),
      vscode.window.onDidChangeTerminalShellIntegration((event) => {
        this.touch(event.terminal, false, false);
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
          this.refresh(false);
        }
      }),
    );

    this.startRefreshTimer();
  }

  attachTreeView(treeView: vscode.TreeView<DashboardNode>): void {
    this.treeView = treeView;
    this.updateBadge();
  }

  refresh(syncNativeNames: boolean | 'terminal' = false, targetActivity?: TerminalActivity): void {
    this.changed.fire();
    this.updateBadge();
    if (syncNativeNames) this.queueNativeNameRefresh(syncNativeNames === 'terminal' ? targetActivity : undefined);
  }

  async refreshNativeNames(): Promise<void> {
    this.nativeNameRefresh = this.nativeNameRefresh
      .then(() => this.applyNativeNameMarkers(), () => this.applyNativeNameMarkers());
    await this.nativeNameRefresh;
  }

  focusTerminal(node: TerminalNode): void {
    this.touch(node.activity.terminal);
    node.activity.terminal.show(false);
  }

  getTreeItem(node: DashboardNode): vscode.TreeItem {
    if (node instanceof BucketNode) {
      const item = new vscode.TreeItem(
        `${BUCKET_LABELS[node.bucket]} (${node.sessions.length})`,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.contextValue = `terminalActivityDashboard.bucket.${node.bucket}`;
      item.iconPath = this.bucketIcon(node.bucket);
      return item;
    }

    const activity = node.activity;
    const now = Date.now();
    const cwd = activity.terminal.shellIntegration?.cwd?.fsPath;
    const item = new vscode.TreeItem(activity.terminal.name, vscode.TreeItemCollapsibleState.None);
    item.description = [formatAge(activity.lastActivity, now), cwd].filter(Boolean).join(' · ');
    item.contextValue = 'terminalActivityDashboard.terminal';
    item.iconPath = this.isActive(activity)
      ? new vscode.ThemeIcon('loading~spin', new vscode.ThemeColor('charts.green'))
      : new vscode.ThemeIcon('terminal');
    item.command = {
      command: 'terminalActivityDashboard.focusTerminal',
      title: 'Focus Terminal',
      arguments: [node],
    };
    const tooltip = new vscode.MarkdownString(undefined, true);
    tooltip.appendMarkdown(`**${escapeMarkdown(activity.terminal.name)}**\n\n`);
    tooltip.appendMarkdown(`Last activity: ${new Date(activity.lastActivity).toLocaleString()}\n\n`);
    if (cwd) tooltip.appendMarkdown(`Directory: \`${escapeMarkdown(cwd)}\`\n\n`);
    if (activity.lastCommand) tooltip.appendMarkdown(`Last command: \`${escapeMarkdown(activity.lastCommand)}\``);
    item.tooltip = tooltip;
    return item;
  }

  getChildren(node?: DashboardNode): DashboardNode[] {
    if (node instanceof TerminalNode) return [];
    if (node instanceof BucketNode) return node.sessions.map((activity) => new TerminalNode(activity));

    const now = Date.now();
    const thresholds = this.thresholds();
    const grouped = new Map<ActivityBucket, TerminalActivity[]>(BUCKET_ORDER.map((bucket) => [bucket, []]));
    for (const activity of this.activities.values()) {
      const bucket = this.displayBucket(this.classifyActivity(activity, now, thresholds));
      grouped.get(bucket)?.push(activity);
    }

    return BUCKET_ORDER
      .map((bucket) => {
        const sessions = grouped.get(bucket) ?? [];
        sessions.sort((a, b) => b.lastActivity - a.lastActivity);
        return new BucketNode(bucket, sessions);
      })
      .filter((group) => group.sessions.length > 0);
  }

  dispose(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    for (const disposable of this.disposables) disposable.dispose();
    this.changed.dispose();
  }

  private trackTerminal(terminal: vscode.Terminal, existingAtActivation: boolean): void {
    const activity = this.ensureActivity(terminal, existingAtActivation);
    void terminal.processId.then((processId) => {
      if (processId === undefined || !this.activities.has(terminal)) return;
      activity.processId = processId;
      const persisted = this.persistedByProcessId.get(processId);
      if (persisted) {
        activity.lastActivity = persisted.lastActivity;
        activity.lastCommand = persisted.lastCommand;
      }
      this.refresh(false);
      void this.persist();
    });
    this.refresh('terminal', activity);
  }

  private ensureActivity(terminal: vscode.Terminal, existingAtActivation = false): TerminalActivity {
    let activity = this.activities.get(terminal);
    if (!activity) {
      activity = {
        terminal,
        baseName: stripNativeMarker(terminal.name),
        lastActivity: Date.now(),
        runningExecutions: 0,
        existingAtActivation,
      };
      this.activities.set(terminal, activity);
    } else if (terminal.name !== activity.lastAppliedNativeName) {
      activity.baseName = stripNativeMarker(terminal.name);
    }
    return activity;
  }

  private touch(terminal: vscode.Terminal, updateTimestamp = true, syncNativeNames: boolean | 'terminal' = false): void {
    const activity = this.ensureActivity(terminal);
    if (updateTimestamp) activity.lastActivity = Date.now();
    this.refresh(syncNativeNames, activity);
    void this.persist();
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

  private startRefreshTimer(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    const seconds = vscode.workspace
      .getConfiguration('terminalActivityDashboard')
      .get<number>('refreshIntervalSeconds', 30);
    this.refreshTimer = setInterval(() => this.refresh(false), Math.max(5, seconds) * 1000);
  }

  private queueNativeNameRefresh(targetActivity?: TerminalActivity): void {
    const enabled = vscode.workspace
      .getConfiguration('terminalActivityDashboard')
      .get<boolean>('nativeNameMarkers', true);
    if (!enabled) return;

    this.nativeNameRefresh = this.nativeNameRefresh
      .then(() => this.applyNativeNameMarkers(targetActivity), () => this.applyNativeNameMarkers(targetActivity));
  }

  private async applyNativeNameMarkers(targetActivity?: TerminalActivity): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('terminalActivityDashboard');
    if (!configuration.get<boolean>('nativeNameMarkers', true)) return;

    const renameExistingTerminals = configuration.get<boolean>('renameExistingTerminals', true);
    const activeTerminal = vscode.window.activeTerminal;
    const now = Date.now();
    const thresholds = this.thresholds();
    const activities = targetActivity ? [targetActivity] : [...this.activities.values()];

    for (const activity of activities) {
      if (!this.activities.has(activity.terminal)) continue;
      if (activity.existingAtActivation && !renameExistingTerminals) continue;
      if (targetActivity && activity.terminal !== vscode.window.activeTerminal) continue;

      const bucket = this.displayBucket(this.classifyActivity(activity, now, thresholds));
      const targetName = `${NATIVE_BUCKET_PREFIXES[bucket]} ${activity.baseName}`;
      if (activity.terminal.name === targetName) {
        activity.lastAppliedNativeName = targetName;
        continue;
      }

      activity.terminal.show(true);
      await vscode.commands.executeCommand('workbench.action.terminal.renameWithArg', { name: targetName });
      activity.lastAppliedNativeName = targetName;
    }

    if (activeTerminal && vscode.window.terminals.includes(activeTerminal)) {
      activeTerminal.show(true);
    }
  }

  private updateBadge(): void {
    if (!this.treeView) return;
    const running = [...this.activities.values()].filter((activity) => this.isActive(activity)).length;
    this.treeView.badge = running > 0 ? { value: running, tooltip: `${running} active terminal${running === 1 ? '' : 's'}` } : undefined;
  }

  private classifyActivity(activity: TerminalActivity, now: number, thresholds: BucketThresholds): ActivityBucket {
    return classifySession(
      { running: activity.runningExecutions > 0, lastActivity: activity.lastActivity },
      now,
      thresholds,
    );
  }

  private isActive(activity: TerminalActivity): boolean {
    const now = Date.now();
    const thresholds = this.thresholds();
    return activity.runningExecutions > 0 || this.classifyActivity(activity, now, thresholds) === 'running';
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

  private bucketIcon(bucket: ActivityBucket): vscode.ThemeIcon {
    switch (bucket) {
      case 'running': return new vscode.ThemeIcon('pulse', new vscode.ThemeColor('charts.green'));
      case 'recent': return new vscode.ThemeIcon('history', new vscode.ThemeColor('charts.blue'));
      case 'parked': return new vscode.ThemeIcon('archive', new vscode.ThemeColor('charts.yellow'));
      case 'stale': return new vscode.ThemeIcon('warning', new vscode.ThemeColor('disabledForeground'));
    }
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new TerminalActivityProvider(context);
  const treeView = vscode.window.createTreeView<DashboardNode>('terminalActivityDashboard.sessions', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  provider.attachTreeView(treeView);

  context.subscriptions.push(
    provider,
    treeView,
    vscode.commands.registerCommand(
      'terminalActivityDashboard.focusTerminal',
      (node: TerminalNode) => provider.focusTerminal(node),
    ),
    vscode.commands.registerCommand('terminalActivityDashboard.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('terminalActivityDashboard.refreshNativeNames', () => provider.refreshNativeNames()),
  );
}

export function deactivate(): void {}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}\[\]()<>#+\-.!|]/g, '\\$&');
}

function stripNativeMarker(value: string): string {
  return value.replace(NATIVE_NAME_MARKER, '');
}
