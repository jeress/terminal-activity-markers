import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'node:module';
import type * as vscode from 'vscode';
import type { TerminalActivityTracker as Tracker } from '../src/extension';

function event<T>() {
  const listeners = new Set<(value: T) => void>();
  return {
    subscribe: (fn: (value: T) => void) => { listeners.add(fn); return { dispose: () => listeners.delete(fn) }; },
    fire: (value: T) => { for (const fn of listeners) fn(value); },
  };
}
const opened = event<vscode.Terminal>();
const closed = event<vscode.Terminal>();
const selected = event<vscode.Terminal | undefined>();
const execution = event<{ terminal: vscode.Terminal }>();
const started = event<{ terminal: vscode.Terminal; execution: { read(): AsyncIterable<string> } }>();
let terminals: vscode.Terminal[] = [];
let active: vscode.Terminal | undefined;
let enabled = true;
let renameCalls = 0;
let rejectRename = false;
const mock = {
  window: {
    get terminals() { return terminals; }, get activeTerminal() { return active; },
    onDidOpenTerminal: opened.subscribe, onDidCloseTerminal: closed.subscribe,
    onDidChangeActiveTerminal: selected.subscribe,
    onDidChangeTerminalShellIntegration: event().subscribe,
    onDidStartTerminalShellExecution: started.subscribe,
    onDidEndTerminalShellExecution: execution.subscribe,
    showWarningMessage: () => { throw new Error('Unexpected automatic warning'); },
  },
  workspace: {
    getConfiguration: () => ({
      get: (key: string, fallback: unknown) => key === 'nativeNameMarkers' ? enabled : fallback,
      inspect: () => ({}), update: async (_: string, value: boolean) => { enabled = value; },
    }),
    onDidChangeConfiguration: event().subscribe,
  },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  commands: { executeCommand: async (_: string, args: { name: string }) => {
    renameCalls++;
    if (rejectRename) throw new Error('Unavailable');
    if (active) (active as { name: string }).name = args.name;
  } },
};
// VS Code is supplied by the extension host in production; use a small event host here.
const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
let TerminalActivityTracker: typeof Tracker;
try {
  loader._load = (id, ...args) => id === 'vscode' ? mock : originalLoad(id, ...args);
  TerminalActivityTracker = (require('../src/extension') as typeof import('../src/extension')).TerminalActivityTracker;
} finally { loader._load = originalLoad; }

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture() {
  const terminal = { name: 'shell', processId: Promise.resolve(123), show: () => { throw new Error('Unexpected reveal'); } } as unknown as vscode.Terminal;
  terminals = [terminal]; active = terminal; enabled = true; renameCalls = 0; rejectRename = false;
  const writes: unknown[] = [];
  const context = { workspaceState: {
    get: () => [{ identity: 'host:123:start', lastActivity: 10 }],
    update: async (_: string, value: unknown) => { writes.push(value); },
  } } as unknown as vscode.ExtensionContext;
  const reader = {
    readProcessIdentity: async () => 'host:123:start',
    readProcessSamples: async () => [{ processId: 123, parentProcessId: 1, cpuSeconds: 0 }],
    readTerminalDeviceMtimes: async () => new Map<number, number>(),
  };
  return { terminal, context, reader, writes };
}
function internals(tracker: Tracker) {
  return tracker as unknown as {
    refreshProcessActivity(): Promise<void>;
    activities: Map<vscode.Terminal, { lastActivity: number; observed: boolean }>;
  };
}

test('polls do not overlap and disposal ignores an in-flight result', async () => {
  const f = fixture();
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  f.reader.readProcessSamples = async () => { calls++; await gate; return []; };
  const tracker = new TerminalActivityTracker(f.context, f.reader);
  try {
    await settle();
    const poll = internals(tracker).refreshProcessActivity();
    await internals(tracker).refreshProcessActivity();
    assert.equal(calls, 1);
    const previousCalls = renameCalls;
    tracker.dispose(); release(); await poll; await settle();
    assert.equal(renameCalls, previousCalls);
  } finally { release(); tracker.dispose(); }
});

test('delayed process identity never overwrites a shell event', async () => {
  const f = fixture();
  let release!: (identity: string) => void;
  f.reader.readProcessIdentity = () => new Promise((resolve) => { release = resolve; });
  const tracker = new TerminalActivityTracker(f.context, f.reader);
  try {
    await settle(); execution.fire({ terminal: f.terminal });
    const observed = internals(tracker).activities.get(f.terminal)!.lastActivity;
    release('host:123:start'); await settle();
    assert.equal(internals(tracker).activities.get(f.terminal)!.lastActivity, observed);
    assert.ok(observed > 10);
  } finally { tracker.dispose(); }
});

test('automatic failures back off without warnings and preserve user names', async () => {
  const f = fixture(); rejectRename = true;
  const tracker = new TerminalActivityTracker(f.context, f.reader);
  try {
    await settle(); assert.equal(renameCalls, 1);
    selected.fire(f.terminal); await settle(); assert.equal(renameCalls, 1);
    rejectRename = false;
    (f.terminal as { name: string }).name = 'Active project';
    await tracker.refreshNativeNames();
    assert.equal(f.terminal.name, '⚪ Active project');
  } finally { tracker.dispose(); }
});

test('device sampling still detects activity when CPU inspection fails', async () => {
  const f = fixture();
  enabled = false; // Avoid rename-generated device timestamp suppression.
  let mtime = 1;
  f.reader.readProcessSamples = async () => { throw new Error('Unsupported'); };
  f.reader.readTerminalDeviceMtimes = async () => new Map([[123, mtime]]);
  const tracker = new TerminalActivityTracker(f.context, f.reader);
  try {
    await settle(); await internals(tracker).refreshProcessActivity();
    mtime++; await internals(tracker).refreshProcessActivity();
    assert.equal(internals(tracker).activities.get(f.terminal)!.observed, true);
  } finally { tracker.dispose(); }
});

test('disable and clear removes markers despite pending automatic updates', async () => {
  const f = fixture();
  const tracker = new TerminalActivityTracker(f.context, f.reader);
  try {
    await settle(); assert.equal(f.terminal.name, '⚪ shell');
    execution.fire({ terminal: f.terminal });
    await tracker.clearNativeNameMarkers(); await settle();
    assert.equal(enabled, false);
    assert.equal(f.terminal.name, 'shell');
    selected.fire(f.terminal); await settle();
    assert.equal(f.terminal.name, 'shell');
  } finally { tracker.dispose(); }
});

test('disposal releases a waiting output reader without waiting for more output', async () => {
  const f = fixture();
  const tracker = new TerminalActivityTracker(f.context, f.reader);
  let returned = false;
  const output: AsyncIterable<string> = {
    [Symbol.asyncIterator]: () => ({
      next: () => new Promise(() => {}),
      return: async () => { returned = true; return { done: true, value: undefined }; },
    }),
  };
  try {
    await settle();
    started.fire({ terminal: f.terminal, execution: { read: () => output } });
    tracker.dispose(); await settle();
    assert.equal(returned, true);
  } finally { tracker.dispose(); }
});

test('closed terminals are excluded from the final persistence snapshot', async () => {
  const f = fixture();
  const tracker = new TerminalActivityTracker(f.context, f.reader);
  try {
    await settle(); closed.fire(f.terminal);
    tracker.dispose(); await settle();
    assert.deepEqual(f.writes.at(-1), []);
  } finally { tracker.dispose(); }
});
