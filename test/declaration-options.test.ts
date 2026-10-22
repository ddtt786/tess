import test from 'node:test';
import assert from 'node:assert/strict';
import { initTreeSitter, parse } from '@tess/parser';

test('declaration assignments also parse after the optional tree front end loads', async () => {
  const source = `function f():
  var local = 0
  at = 1
  list items = []
  visible += 1
end`;
  const expected = parse(source, { validate: false });
  assert.ok(expected.ok);
  assert.ok(await initTreeSitter());
  assert.deepEqual(parse(source, { validate: false }), expected);
});
