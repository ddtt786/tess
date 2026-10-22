import test from 'node:test';
import assert from 'node:assert/strict';
import { compileProject } from '@tess/compiler';
import { decompileProject } from '@tess/decompiler';
import { Vm } from '@tess/vm';

function fixture() {
  const built = compileProject(`
var input = 0
var hits = 0
var out = 0
var entry_condition = 0
var entry_no_value = 0
function probe():
  hits += 1
  return input
end
object "o":
  when start do
    if true:
      out = 1
    end
  end
end`);
  assert.deepEqual(built.errors, []);
  const project = built.project!;
  const stacks = JSON.parse(project.objects[0]!.script);
  const condition = stacks[0][1];
  const call = { type: `func_${project.functions[0]!.id}`, params: [] };
  return { project, stacks, condition, call };
}

function roundtrip(project: ReturnType<typeof fixture>['project']) {
  const decompiled = decompileProject(project, [], { inline: true });
  assert.deepEqual(decompiled.warnings, []);
  const result = compileProject(decompiled.source);
  assert.deepEqual(result.errors, []);
  return result.project!;
}

function run(project: ReturnType<typeof fixture>['project'], input: unknown) {
  const vm = new Vm({ renderer: null, audio: null });
  vm.load(project as never);
  vm.start();
  vm.variables.find(v => v.name === 'input')!.setValue(input as string | number);
  for (let i = 0; i < 30; i++) vm.tick();
  assert.deepEqual(vm.errors, []);
  const value = (name: string) => vm.variables.find(v => v.name === name)!.getValue();
  return { out: Number(value('out')), hits: Number(value('hits')) };
}

test('round-trip preserves numeric condition conversion and evaluates a value call once', () => {
  const cases: Array<[unknown, boolean]> = [
    [0, false], [1, true], [-2, true], ['', false], [' ', false],
    ['0', false], ['0.00', false], ['0e2', false], ['0x0', false],
    ['false', true], ['undefined', true], [false, false], [true, true],
  ];
  for (const negate of [false, true]) {
    const { project, stacks, condition, call } = fixture();
    condition.params[0] = negate ? { type: 'boolean_not', params: [null, call, null] } : call;
    project.objects[0]!.script = JSON.stringify(stacks);
    const converted = roundtrip(project);
    for (const [input, truth] of cases) {
      const expected = { out: Number(negate ? !truth : truth), hits: 1 };
      assert.deepEqual(run(project, input), expected, `original ${JSON.stringify({ input, negate })}`);
      assert.deepEqual(run(converted, input), expected, `roundtrip ${JSON.stringify({ input, negate })}`);
    }
    // Tess writes a stored judgement as "FALSE", so that text can no longer be
    // told apart from entry's false; the round-trip reads it as false.
    assert.deepEqual(run(project, 'FALSE'), { out: Number(!negate), hits: 1 });
    assert.deepEqual(run(converted, 'FALSE'), { out: Number(negate), hits: 1 });
  }
});

test('round-trip keeps an undefined return falsy without discarding its side effects', () => {
  const { project, stacks, condition, call } = fixture();
  const fn = project.functions[0]!;
  const content = JSON.parse(fn.content);
  content[0][0].type = 'function_create';
  content[0][0].params = content[0][0].params.slice(0, 2);
  fn.type = 'normal';
  fn.content = JSON.stringify(content);
  condition.params[0] = call;
  project.objects[0]!.script = JSON.stringify(stacks);
  const expected = { out: 0, hits: 1 };
  assert.deepEqual(run(project, 1), expected);
  assert.deepEqual(run(roundtrip(project), 1), expected);
});

test('a function returning a boolean block retains false in a condition', () => {
  const { project, stacks, condition, call } = fixture();
  const fn = project.functions[0]!;
  const content = JSON.parse(fn.content);
  content[0][0].params[3] = { type: 'False', params: [null] };
  fn.content = JSON.stringify(content);
  condition.params[0] = call;
  project.objects[0]!.script = JSON.stringify(stacks);
  const expected = { out: 0, hits: 1 };
  assert.deepEqual(run(project, 1), expected);
  assert.deepEqual(run(roundtrip(project), 1), expected);
});

test('numeric conditions survive if/else, loop and wait conversion', () => {
  for (const kind of ['if_else', 'repeat_while_true', 'wait_until_true']) {
    const { project, stacks, condition, call } = fixture();
    condition.type = kind;
    condition.params = [call, 'while', null];
    const inputId = project.variables.find(v => v.name === 'input')!.id;
    if (kind === 'if_else') {
      condition.statements[1] = [{ type: 'set_variable', params: [
        project.variables.find(v => v.name === 'out')!.id, { type: 'number', params: ['2'] },
      ] }];
    } else if (kind === 'repeat_while_true') {
      condition.statements[0].push({ type: 'set_variable', params: [inputId, { type: 'number', params: ['0'] }] });
    } else {
      stacks[0].push(...condition.statements[0]);
      condition.statements = [];
    }
    project.objects[0]!.script = JSON.stringify(stacks);
    const converted = roundtrip(project);
    for (const input of [0, 1]) assert.deepEqual(run(converted, input), run(project, input), `${kind}: ${input}`);
  }
});

test('boolean return types are preserved through chained value functions', () => {
  const { project, stacks, condition } = fixture();
  const first = project.functions[0]!;
  const content = JSON.parse(first.content);
  content[0][0].params[3] = { type: 'False', params: [null] };
  first.content = JSON.stringify(content);
  const relay = structuredClone(first);
  relay.id = 'relay';
  const relayContent = JSON.parse(relay.content);
  relayContent[0][0].params[0] = { type: 'function_field_label', params: ['relay', null] };
  relayContent[0][0].params[3] = { type: `func_${first.id}`, params: [] };
  relayContent[0][0].statements = [[]];
  relay.content = JSON.stringify(relayContent);
  project.functions.push(relay);
  condition.params[0] = { type: 'func_relay', params: [] };
  project.objects[0]!.script = JSON.stringify(stacks);
  const expected = { out: 0, hits: 1 };
  assert.deepEqual(run(project, 1), expected);
  assert.deepEqual(run(roundtrip(project), 1), expected);
});

test('empty condition slots stay false after round-trip', () => {
  const empty = [
    null,
    { type: 'boolean_not', params: [null, null, null] },
    { type: 'boolean_and_or', params: [null, 'OR', null] },
    { type: 'boolean_or', params: [null, null, null] },
  ];
  for (const slot of empty) {
    const { project, stacks, condition } = fixture();
    condition.params[0] = slot;
    project.objects[0]!.script = JSON.stringify(stacks);
    assert.deepEqual(run(roundtrip(project), 1), run(project, 1), JSON.stringify(slot));
  }
});

test('legacy and/or keep numeric condition conversion for value calls', () => {
  for (const type of ['boolean_and', 'boolean_or']) {
    const { project, stacks, condition, call } = fixture();
    condition.params[0] = { type, params: [call, null, { type: 'True', params: [null] }] };
    project.objects[0]!.script = JSON.stringify(stacks);
    const converted = roundtrip(project);
    for (const input of [0, 1]) assert.deepEqual(run(converted, input), run(project, input), `${type}: ${input}`);
  }
});

test('a judgement stored in a variable keeps its truth after round-trip', () => {
  for (const [left, truth] of [['1', true], ['2', false]] as const) {
    const { project, stacks, condition } = fixture();
    const inputId = project.variables.find((v) => v.name === 'input')!.id;
    const set = {
      type: 'set_variable',
      params: [inputId, {
        type: 'boolean_basic_operator',
        params: [{ type: 'number', params: [left] }, 'EQUAL', { type: 'number', params: ['1'] }],
      }, null],
    };
    stacks[0].splice(1, 0, set);
    condition.params[0] = { type: 'get_variable', params: [inputId, null] };
    project.objects[0]!.script = JSON.stringify(stacks);
    const expected = { out: Number(truth), hits: 0 };
    for (const proj of [project, roundtrip(project)]) {
      const vm = new Vm({ renderer: null, audio: null });
      vm.load(proj as never);
      vm.start();
      vm.tick();
      const value = (name: string) => Number(vm.variables.find((v) => v.name === name)!.getValue());
      assert.deepEqual({ out: value('out'), hits: value('hits') }, expected, `${left}`);
    }
  }
});

test('text blocks reading "true" and "false" stay text after round-trip', () => {
  const source = `var a = 0
var b = 0
var same = 0
object "o":
  when start do
    a = "true"
    b = "false"
    if (a == "true"):
      same = 1
    end
  end
end`;
  const built = compileProject(source);
  assert.deepEqual(built.errors, []);
  for (const proj of [built.project!, roundtrip(built.project!)]) {
    const vm = new Vm({ renderer: null, audio: null });
    vm.load(proj as never);
    vm.start();
    vm.tick();
    const value = (name: string) => vm.variables.find((v) => v.name === name)!.getValue();
    assert.deepEqual([value('a'), value('b'), Number(value('same'))], ['true', 'false', 1]);
  }
});
