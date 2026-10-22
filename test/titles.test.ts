import assert from 'node:assert/strict';
import test from 'node:test';
import { ApplicationTitleReader } from '../src/titles';

test('reads Codex OSC 0 and OSC 2 titles across arbitrary stream boundaries', () => {
  const reader = new ApplicationTitleReader();
  const received: string[] = [];
  for (const char of 'ordinary output\x1b]0;Initial session\x07\x1b]2;Renamed session\x1b\\') {
    const title = reader.read(char);
    if (title !== undefined) received.push(title);
  }
  assert.deepEqual(received, ['Initial session', 'Renamed session']);
});

test('ignores output, links, clipboard commands, and malformed or oversized titles', () => {
  const reader = new ApplicationTitleReader();
  assert.equal(reader.read('private output\x1b[32mcolored\x1b[0m'), undefined);
  assert.equal(reader.read('\x1b]52;c;clipboard\x07\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\'), undefined);
  assert.equal(reader.read(`\x1b]0;${'x'.repeat(100_000)}\x07`), undefined);
  assert.equal(reader.read('\x1b]2;bad\ncontrol\x07'), undefined);
  assert.equal(reader.read('\x1b]0;Valid session\x07'), 'Valid session');
});

test('keeps the latest complete title, including explicit empty title resets', () => {
  const reader = new ApplicationTitleReader();
  assert.equal(reader.read('\x1b]0;First\x07\x1b]0;Second\x07'), 'Second');
  assert.equal(reader.read('\x1b]0;\x07'), '');
  assert.equal(reader.read('\x9d2;Unicode café\x9c'), 'Unicode café');
});
