/**
 * @fileoverview 번역 블록이 부르는 곳입니다.
 *
 * 엔트리는 파파고를 제 서버 뒤에 두고 씁니다(`AI_UTILIZE_BLOCK.translate`). 같은
 * 주소를 그대로 부르므로 작품은 사이트에서와 같은 번역을 받습니다 — 사이트 위에서는
 * 곧바로, `tessvm run` 위에서는 그 서버가 같은 자리를 엔트리로 넘겨 줍니다. 답을 받지
 * 못하면 빈 글자를 돌려 블록이 엔트리의 기본 답("알 수 없는 문장입니다.")을 내게 둡니다.
 */
import type { Translator } from '../runtime/engine.ts';

const API = '/api/expansionBlock/papago/';
/** `apiType` — 엔트리가 번역에 쓰는 파파고 엔진. */
const ENGINE = 'n2mt';
/** Entry gives an api this long before it takes the default answer (`callApi`). */
const TIMEOUT_MS = 3000;

export class EntryTranslator implements Translator {
  /**
   * Always same-origin: the site answers it itself, and `tessvm run` hands the
   * same address to entry. A page that is neither has nothing there, which the
   * blocks read as an answer they did not get.
   */
  private async call(path: string, query: Record<string, string>): Promise<Record<string, unknown>> {
    try {
      const response = await fetch(`${API}${path}?${new URLSearchParams(query)}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return response.ok ? ((await response.json()) as Record<string, unknown>) : {};
    } catch {
      // Offline, refused, or slower than entry itself waits.
      return {};
    }
  }

  async translate(text: string, source: string, target: string): Promise<string> {
    const body = await this.call(`translate/${ENGINE}`, { text, source, target });
    return typeof body.translatedText === 'string' ? body.translatedText : '';
  }

  async detect(text: string): Promise<string> {
    const body = await this.call('dect/langs', { query: text });
    return typeof body.langCode === 'string' ? body.langCode : '';
  }
}
