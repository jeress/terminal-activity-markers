import assert from 'node:assert/strict';
import test from 'node:test';
import { RefreshQueue } from '../src/scheduler';

test('a burst during slow work becomes one follow-up without overlapping', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const queue = new RefreshQueue(async () => { if (++calls === 1) await gate; });
  const done = queue.request('automatic');
  await Promise.resolve();
  for (let i = 0; i < 1000; i++) void queue.request('automatic');
  assert.equal(calls, 1);
  release(); await done;
  assert.equal(calls, 2);
});

test('clear supersedes pending marker updates', async () => {
  const calls: string[] = [];
  const queue = new RefreshQueue(async (kind) => { calls.push(kind); });
  const done = queue.request('automatic');
  void queue.request('manual');
  void queue.request('clear');
  void queue.request('automatic');
  await done;
  assert.deepEqual(calls, ['clear']);
});

test('disposal drops queued work', async () => {
  let calls = 0;
  const queue = new RefreshQueue(async () => { calls++; });
  const done = queue.request('automatic');
  queue.dispose(); await done; await queue.request('manual');
  assert.equal(calls, 0);
});

test('a failed request does not poison later requests', async () => {
  let calls = 0;
  const queue = new RefreshQueue(async () => { if (++calls === 1) throw new Error('failure'); });
  await assert.rejects(queue.request('manual'), /failure/);
  await queue.request('manual');
  assert.equal(calls, 2);
});
