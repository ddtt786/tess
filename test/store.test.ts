/**
 * `store` — 실행 사이에 남는 이름들을 확인합니다.
 *
 * 규약은 엔트리 확장 프로그램 Entry Save Manager 의 것입니다. 전역 변수·리스트 이름이
 * `@` 로 시작하면 그 확장이 값을 맡아 두고, 작품이 `@저장` 함수를 부르면 써 두며
 * (`@비동기저장` 은 기다리지 않습니다), 확장이 있는 동안 `@확장프로그램` 이 1 입니다.
 * Tess 는 같은 자리를 `store var` · `store list` · `save` · `save async` · `can_save`
 * 로 적고, 컴파일·되돌리기가 그 이름들을 오갑니다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileProject } from '@tess/compiler';
import { decompileProject } from '@tess/decompiler';
import { Vm } from '@tess/vm';
import type { RawEntity } from '@tess/decompiler';

const WORK = `store var 골드 = 0
store list 인벤토리 = ["검"]

scene "장면 1":
  object "주인공":
    when start do
      if can_save:
        골드 = 골드 + 10
        save
        save async
      end
    end
  end
end`;

/** 컴파일한 작품. 컴파일 오류가 있으면 그 자리에서 실패합니다. */
function build(source = WORK) {
  const result = compileProject(source, { path: 'main.tess' });
  assert.deepEqual(result.errors.map((error) => error.message), []);
  return result.project as unknown as RawEntity;
}

const names = (project: RawEntity) =>
  (project.variables as RawEntity[]).map((variable) => String(variable.name));

/** 블록 트리에 나오는 블록 타입을 순서대로 늘어놓습니다. */
function blockTypes(script: unknown, found: string[] = []): string[] {
  if (Array.isArray(script)) {
    script.forEach((item) => blockTypes(item, found));
    return found;
  }
  if (script && typeof script === 'object') {
    const block = script as { type?: string; params?: unknown; statements?: unknown };
    if (block.type) found.push(block.type);
    blockTypes(block.params, found);
    blockTypes(block.statements, found);
  }
  return found;
}

/** 함수 머리에 적힌 이름 — 세이브 매니저가 알아보는 자리입니다. */
function functionLabels(project: RawEntity): string[] {
  return (project.functions as RawEntity[]).map((fn) => {
    const create = (JSON.parse(String(fn.content)) as RawEntity[][])[0]![0]!;
    return String(((create.params as RawEntity[])[0] as RawEntity).params![0]);
  });
}

// ---------------------------------------------------------------------------
//  Tess -> 엔트리
// ---------------------------------------------------------------------------
test('store 는 이름 앞에 @ 를 붙인 전역 변수·리스트가 된다', () => {
  const project = build();
  assert.ok(names(project).includes('@골드'));
  assert.ok(names(project).includes('@인벤토리'));
  const list = (project.variables as RawEntity[]).find((item) => item.name === '@인벤토리')!;
  assert.equal(list.variableType, 'list');
  assert.deepEqual(list.array, [{ data: '검' }]);
});

test('store 는 이름을 따로 적어도 그 이름 앞에 @ 가 붙는다', () => {
  const project = build('store var 골드 as "게임 머니" = 0\n' + WORK.split('\n').slice(2).join('\n'));
  assert.ok(names(project).includes('@게임 머니'));
});

test('save 는 @저장 · save async 는 @비동기저장 함수를 부른다', () => {
  const project = build();
  assert.deepEqual(functionLabels(project).sort(), ['@비동기저장', '@저장']);

  // 부르는 자리는 그 함수의 호출 블록이고, 함수 본문은 비어 있습니다 — 확장이
  // 그 호출을 가로채기 때문입니다.
  const calls = blockTypes(JSON.parse(String((project.objects as RawEntity[])[0]!.script)))
    .filter((type) => type.startsWith('func_'));
  assert.equal(calls.length, 2);
  const ids = (project.functions as RawEntity[]).map((fn) => `func_${fn.id}`);
  assert.deepEqual(calls.slice().sort(), ids.slice().sort());
  for (const fn of project.functions as RawEntity[]) {
    const create = (JSON.parse(String(fn.content)) as RawEntity[][])[0]![0]!;
    assert.deepEqual((create.statements as unknown[][])[0], [], '본문은 비어 있습니다');
  }
});

test('같은 저장을 여러 번 써도 함수는 하나씩만 만들어진다', () => {
  const project = build(WORK.replace('        save\n', '        save\n        save\n'));
  assert.equal((project.functions as RawEntity[]).length, 2);
});

test('can_save 는 @확장프로그램 이 1 인지 보는 판단이다', () => {
  const project = build();
  const flag = (project.variables as RawEntity[]).find((item) => item.name === '@확장프로그램');
  assert.ok(flag, '@확장프로그램 변수가 생깁니다');
  assert.equal(flag!.value, 0, '확장이 없으면 0 그대로입니다');

  const script = JSON.parse(String((project.objects as RawEntity[])[0]!.script)) as RawEntity[][];
  const test_ = ((script[0]![1] as RawEntity).params as RawEntity[])[0]!;
  assert.equal(test_.type, 'boolean_basic_operator');
  assert.equal((test_.params as unknown[])[1], 'EQUAL');
  assert.equal((((test_.params as RawEntity[])[0]).params as unknown[])[0], flag!.id);
});

test('can_save 를 쓰지 않으면 @확장프로그램 도 만들지 않는다', () => {
  const project = build('store var 골드 = 0\nscene "s":\n  object "o":\n    when start do\n      save\n    end\n  end\nend');
  assert.equal(names(project).includes('@확장프로그램'), false);
});

// ---------------------------------------------------------------------------
//  엔트리 -> Tess
// ---------------------------------------------------------------------------
test('되돌리면 store 선언과 save · can_save 가 그대로 돌아온다', () => {
  const back = decompileProject(build(), [], { inline: true });
  assert.deepEqual(back.warnings, [], back.warnings.join('\n'));
  assert.match(back.source, /store var 골드 = 0/);
  assert.match(back.source, /store list 인벤토리 = \["검"\]/);
  assert.match(back.source, /if can_save:/);
  assert.match(back.source, /\n\s+save\n/);
  assert.match(back.source, /\n\s+save async\n/);
  // 저장 함수는 Tess 문장이 대신하므로 함수 선언으로 남지 않습니다.
  assert.doesNotMatch(back.source, /function .*저장/);
});

test('되돌린 것을 다시 컴파일하면 같은 이름과 같은 함수가 나온다', () => {
  const first = build();
  const back = decompileProject(first, [], { inline: true });
  const again = compileProject(back.source, { path: 'main.tess' });
  assert.deepEqual(again.errors.map((error) => error.message), []);
  const second = again.project as unknown as RawEntity;
  assert.deepEqual(names(second).sort(), names(first).sort());
  assert.deepEqual(functionLabels(second).sort(), functionLabels(first).sort());
});

test('@ 가 붙은 이름이 Tess 이름으로 쓸 수 없으면 as 로 남긴다', () => {
  const project = build('store var 골드 as "게임 머니" = 0\nscene "s":\n  object "o":\n    when start do\n      save\n    end\n  end\nend');
  const back = decompileProject(project, [], { inline: true });
  assert.match(back.source, /store var \S+ as "게임 머니" = 0/);
  const again = compileProject(back.source, { path: 'main.tess' });
  assert.deepEqual(again.errors.map((error) => error.message), []);
  assert.ok(names(again.project as unknown as RawEntity).includes('@게임 머니'));
});

// ---------------------------------------------------------------------------
//  tessvm 에서 실제로 저장하기
// ---------------------------------------------------------------------------
/** 값을 손에 들고 있는 가짜 저장소. 실제로는 Dexie(IndexedDB)가 그 자리입니다. */
function fakeHost(values: Record<string, unknown> = {}) {
  const writes: Array<Record<string, unknown>> = [];
  return {
    writes,
    host: {
      read: () => Promise.resolve({ ...values } as never),
      write: (next: Record<string, unknown>) => {
        writes.push(next);
        Object.assign(values, next);
        return Promise.resolve();
      },
    },
  };
}

/** 작품을 싣고 저장소를 붙인 실행기. */
async function runWith(host: unknown, source = WORK) {
  const vm = new Vm({ renderer: null, audio: null });
  vm.load(build(source) as never);
  vm.save.host = host as never;
  await vm.save.load();
  vm.start();
  return vm;
}

const valueOf = (vm: Vm, name: string) =>
  vm.variables.find((variable) => variable.name === name)?.getValue();

test('저장한 값은 작품이 시작하기 전에 들어가 있다', async () => {
  const store = fakeHost({ '@골드': 70, '@인벤토리': [{ data: '방패' }] });
  const vm = await runWith(store.host);
  assert.equal(valueOf(vm, '@골드'), 70);
  assert.deepEqual(
    vm.variables.find((variable) => variable.name === '@인벤토리')!.getArray(),
    [{ data: '방패' }],
  );
});

test('저장소가 있으면 can_save 가 참이고, 저장하면 지금 값이 나간다', async () => {
  const store = fakeHost({ '@골드': 70 });
  const vm = await runWith(store.host);
  assert.equal(valueOf(vm, '@확장프로그램'), 1);

  vm.tick();
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(valueOf(vm, '@골드'), 80, 'if 안이 돌았습니다');
  assert.ok(store.writes.length >= 1);
  assert.equal(store.writes[0]!['@골드'], 80);
  assert.deepEqual(store.writes[0]!['@인벤토리'], [{ data: '검' }]);
});

test('다시 시작하면 저장한 값으로 돌아간다', async () => {
  const store = fakeHost({ '@골드': 70 });
  const vm = await runWith(store.host);
  vm.tick();
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(valueOf(vm, '@골드'), 80);

  vm.stop();
  vm.start();
  assert.equal(valueOf(vm, '@골드'), 80, '저장한 값이 다음 실행의 시작 값입니다');
});

test('저장소가 없으면 can_save 는 거짓이고 아무것도 나가지 않는다', async () => {
  const vm = await runWith(null);
  assert.equal(valueOf(vm, '@확장프로그램'), 0);
  vm.tick();
  assert.equal(valueOf(vm, '@골드'), 0, 'if 안은 돌지 않습니다');
});

test('save 는 저장이 끝날 때까지 기다리고, save async 는 기다리지 않는다', async () => {
  let landed: (() => void) | null = null;
  const slow = {
    read: () => Promise.resolve({}),
    write: () => new Promise<void>((done) => {
      landed = done;
    }),
  };
  const vm = await runWith(
    slow,
    `store var 횟수 = 0
scene "s":
  object "o":
    when start do
      save
      횟수 = 1
    end
  end
end`,
  );
  vm.tick();
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(Number(valueOf(vm, '@횟수')), 0, '저장이 끝나기 전에는 다음 문장으로 가지 않습니다');

  landed!();
  await new Promise((done) => setTimeout(done, 0));
  vm.tick();
  // 엔트리의 '변수 정하기' 는 값을 글자로 담으므로 숫자로 맞춰서 봅니다.
  assert.equal(Number(valueOf(vm, '@횟수')), 1);
});
