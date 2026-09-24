/**
 * 값을 돌려주는 함수를 문장으로 부르면 엔트리에서도 실행되고, 되돌리면 같은 호출로 읽힌다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileProject } from '../packages/compiler/src/index.ts';
import { decompileProject } from '../packages/decompiler/src/index.ts';

const SOURCE = `scene "s":
  object "a":
    function 두배(x):
      say x
      return x * 2
    end
    when start do
      두배(3)
      say 두배(4)
    end
  end
end
`;

test('값 함수를 문장으로 부르면 빈 if 의 조건으로 컴파일된다', () => {
  const result = compileProject(SOURCE);
  assert.deepEqual(result.errors, []);
  const script = JSON.parse((result.project as any).objects[0].script);
  const first = script[0][1];
  assert.equal(first.type, '_if');
  assert.deepEqual(first.statements, [[]]);
  assert.equal(first.params[0].type, 'boolean_basic_operator');
  assert.match(first.params[0].params[0].type, /^func_/);
});

test('되돌리면 문장 호출로 읽힌다', () => {
  const result = compileProject(SOURCE);
  const back = decompileProject(result.project as any, [], { inline: true }).source;
  assert.match(back, /^\s+두배\(3\)$/m);
  assert.doesNotMatch(back, /if 두배/);
});
