import assert from 'node:assert/strict';
import test from 'node:test';
import { NamedTerminal, TerminalRenamer } from '../src/renamer';

function setup() {
  const shows: boolean[] = [];
  const names: string[] = [];
  let active: NamedTerminal | undefined;
  const terminals = new Set<NamedTerminal>();
  let duringRename = () => {};
  const renamer = new TerminalRenamer<NamedTerminal>({
    active: () => active,
    exists: (terminal) => terminals.has(terminal),
    rename: async (name) => {
      names.push(name);
      if (active) (active as { name: string }).name = name;
      duringRename();
    },
    wait: async () => {},
  });
  const select = (terminal: NamedTerminal | undefined) => { active = terminal; renamer.selectionChanged(terminal); };
  const make = (name: string) => {
    const terminal = { name, show(preserveFocus?: boolean) { shows.push(!!preserveFocus); select(terminal); } };
    terminals.add(terminal);
    return terminal;
  };
  const a = make('a'); const b = make('b'); const c = make('c'); select(a);
  return { renamer, a, b, c, shows, names, terminals, select, active: () => active,
    duringRename: (fn: () => void) => { duringRename = fn; } };
}

test('unchanged full refresh never reveals a terminal', async () => {
  const s = setup();
  await s.renamer.apply([s.a, s.b], (t) => t.name, true, () => true, () => {});
  assert.deepEqual(s.shows, []);
  assert.deepEqual(s.names, []);
});

test('automatic refresh only renames selected terminal without revealing it', async () => {
  const s = setup();
  await s.renamer.apply([s.a, s.b], (t) => `🟢 ${t.name}`, false, () => true, () => {});
  assert.deepEqual(s.names, ['🟢 a']);
  assert.deepEqual(s.shows, []);
  assert.equal(s.active(), s.a);
});

test('explicit refresh restores selection with preserveFocus', async () => {
  const s = setup();
  await s.renamer.apply([s.a, s.b], (t) => `🟢 ${t.name}`, true, () => true, () => {});
  assert.deepEqual(s.names, ['🟢 a', '🟢 b']);
  assert.deepEqual(s.shows, [true, true]);
  assert.equal(s.active(), s.a);
});

test('user selection during a refresh stops the sweep and wins over restoration', async () => {
  const s = setup();
  s.duringRename(() => s.select(s.c));
  await s.renamer.apply([s.b, s.a], (t) => `🟢 ${t.name}`, true, () => true, () => {});
  assert.equal(s.active(), s.c);
  assert.deepEqual(s.names, ['🟢 b']);
  assert.deepEqual(s.shows, [true]);
});

test('terminal closure during rename is tolerated', async () => {
  const s = setup();
  s.duringRename(() => { s.terminals.delete(s.b); s.select(s.c); });
  let results = 0;
  await s.renamer.apply([s.b], () => '🟢 b', true, () => true, () => { results++; });
  assert.equal(results, 0);
  assert.equal(s.active(), s.c);
});

test('disabling markers during a sweep prevents subsequent renames', async () => {
  const s = setup();
  let enabled = true;
  s.duringRename(() => { enabled = false; });
  await s.renamer.apply([s.a, s.b], (t) => `🟢 ${t.name}`, true, () => enabled, () => {});
  assert.deepEqual(s.names, ['🟢 a']);
});

test('disposal cancels pending renames and restoration', async () => {
  const s = setup();
  s.duringRename(() => s.renamer.dispose());
  await s.renamer.apply([s.b, s.a], (t) => `🟢 ${t.name}`, true, () => true, () => {});
  assert.deepEqual(s.names, ['🟢 b']);
  assert.deepEqual(s.shows, [true]);
});

test('name changed while selecting a terminal is preserved', async () => {
  const s = setup();
  s.b.show = () => { s.b.name = 'User name'; s.select(s.b); };
  await s.renamer.apply([s.b], () => '🟢 b', true, () => true, () => {});
  assert.equal(s.b.name, 'User name');
  assert.deepEqual(s.names, []);
});
