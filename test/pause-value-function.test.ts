import test from 'node:test';
import assert from 'node:assert/strict';
import { compileProject } from '@tess/compiler';
import { Vm } from '@tess/vm';

function machine(source: string, options: ConstructorParameters<typeof Vm>[0] = {}): Vm {
  const compiled = compileProject(source);
  assert.deepEqual(compiled.errors, []);
  const vm = new Vm({ renderer: null, audio: null, ...options });
  vm.load(compiled.project as unknown as never);
  vm.start();
  vm.tick();
  return vm;
}

const value = (vm: Vm, name: string) => Number(vm.variables.find((v) => v.name === name)!.getValue());

test('pause completes a frame-waiting value call without executing its remaining body', () => {
  const vm = machine(`
var out = 0
var skipped = 0
var unrelated = 0
function f():
  var local = 10
  wait false
  skipped = 1
  return local
end
object "o":
  when start do
    out = f()
  end
  when start do
    wait false
    unrelated = 1
  end
end`);
  assert.equal(value(vm, 'out'), 0);
  vm.pause();
  assert.equal(vm.state, 'pause');
  assert.equal(value(vm, 'out'), 10);
  assert.equal(value(vm, 'skipped'), 0);
  assert.equal(value(vm, 'unrelated'), 0);
  assert.deepEqual(vm.errors, []);
  assert.equal(vm.targets[0]!.threads[0]!.depth, 0);
});

test('pause returns through the caller and stops again at its next frame boundary', () => {
  const vm = machine(`
var out = 0
var called = 0
var after = 0
function f():
  wait 100
  return 10
end
function g(a):
  called = a
  wait false
  after = 1
end
object "o":
  when start do
    g(f())
  end
end`);
  vm.pause();
  assert.equal(value(vm, 'called'), 10);
  assert.equal(value(vm, 'after'), 0);
  assert.deepEqual(vm.errors, []);
});

test('pause completes nested value calls and evaluates a yielding return expression', () => {
  const vm = machine(`
var out = 0
var skipped = 0
function f():
  wait false
  return 10
end
function g():
  skipped = f()
  return (f() + 2)
end
object "o":
  when start do
    out = g()
  end
end`);
  vm.pause();
  assert.equal(value(vm, 'out'), 12);
  assert.equal(value(vm, 'skipped'), 0);
  assert.deepEqual(vm.errors, []);
});

test('a value function waiting for a promise stays paused until resume', async () => {
  let finish!: () => void;
  const reading = new Promise<void>((resolve) => { finish = resolve; });
  const vm = machine(`
var out = 0
function f():
  read "hello" and wait
  return 10
end
object "o":
  when start do
    out = f()
  end
end`, { speech: { speak: () => reading, stop() {} } });
  vm.pause();
  assert.equal(value(vm, 'out'), 0);
  finish();
  await reading;
  assert.equal(value(vm, 'out'), 0);
  vm.start();
  vm.tick();
  assert.equal(value(vm, 'out'), 10);
  assert.deepEqual(vm.errors, []);
});

test('stop discards pending value calls without running their callers', () => {
  const vm = machine(`
var out = 0
function f():
  wait false
  return 10
end
object "o":
  when start do
    out = f()
  end
end`);
  vm.stop();
  vm.pause();
  assert.equal(value(vm, 'out'), 0);
  assert.equal(vm.state, 'stop');
});
