import assert from 'node:assert/strict';
import test from 'node:test';
import { executeProcess, readProcessIdentity, readProcessSamples } from '../src/processes';

test('process inspection returns the identity and CPU sample of this process', async () => {
  const signal = new AbortController().signal;
  const identity = await readProcessIdentity(process.pid, signal);
  assert.ok(identity.includes(`:${process.pid}:`));
  assert.equal(await readProcessIdentity(process.pid, signal), identity);
  assert.ok((await readProcessSamples(signal)).some((sample) => sample.processId === process.pid));
});

test('subprocesses can be cancelled on disposal', async () => {
  const abort = new AbortController();
  const child = executeProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], abort.signal);
  abort.abort();
  await assert.rejects(child, { name: 'AbortError' });
});

test('hung subprocesses time out', async () => {
  await assert.rejects(executeProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], new AbortController().signal));
});
