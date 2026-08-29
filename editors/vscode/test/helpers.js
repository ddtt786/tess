// Shared fixtures for the language server tests.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

export const extensionRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const repoRoot = path.resolve(extensionRoot, '..', '..');

/** The bundled headless analysis API. Requires `npm run build`. */
export const api = require(path.join(extensionRoot, 'out', 'language.cjs'));

export const SAMPLE = `project:
  title "테스트"
end

var 점수 = 0

scene "메인":
  object "고양이":
    default costume 기본 "cat.png"
    sound 야옹 "meow.mp3"
    var 체력 = 100

    function 더하기(a, b):
      return a + b
    end

    when start do
      say 점수
      체력 = 더하기(체력, 1)
      forever:
        if key_down("right"):
          x += 5
        end
        wait 0.02
      end
    end
  end
end
`;

/** Zero based position of a needle in the sample, offset into the match. */
export function positionOf(text, needle, column = 0) {
    const lines = text.split('\n');
    const line = lines.findIndex((entry) => entry.includes(needle));
    if (line < 0) throw new Error(`not found: ${needle}`);
    return { line, character: lines[line].indexOf(needle) + column };
}
