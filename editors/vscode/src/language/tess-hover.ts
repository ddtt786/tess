// ============================================================================
//  Hover
//
//  Declarations show where they came from; keywords and built ins show the form
//  the grammar accepts plus a one line summary.
// ============================================================================
import type { LangiumDocument, MaybePromise } from 'langium';
import type { Hover, HoverParams } from 'vscode-languageserver';
import { BUILTIN_FUNCTIONS, OBJECT_PROPERTIES, STATE_VALUES, TEXT_ONLY_PROPERTIES } from './tess-core.js';
import {
    FUNCTION_DOCS, PROPERTY_DOCS, STATE_DOCS, STATEMENT_DOCS, renderDoc,
} from './tess-docs.js';
import type { Target } from './tess-model.js';
import { modelOf } from './tess-model.js';
import type { TessSymbol } from './tess-symbols.js';

const KIND_LABELS: Record<TessSymbol['kind'], string> = {
    variable: '변수',
    list: '리스트',
    function: '함수',
    param: '매개변수',
    object: '오브젝트',
    text: '글상자',
    scene: '장면',
    costume: '모양',
    sound: '소리',
    signal: '신호',
};

export class TessHoverProvider {
    getHoverContent(document: LangiumDocument, params: HoverParams): MaybePromise<Hover | undefined> {
        const model = modelOf(document);
        if (!model) return undefined;
        const target = model.targetAt(model.offsetAt(params.position));
        if (!target) return undefined;
        const value = this.content(target);
        if (!value) return undefined;
        return { contents: { kind: 'markdown', value }, range: target.range };
    }

    private content(target: Target): string | undefined {
        if (target.symbol) return this.symbolHover(target.symbol);

        const { text } = target;
        if (target.kind === 'callee' || BUILTIN_FUNCTIONS.has(text)) {
            const doc = FUNCTION_DOCS[text];
            if (doc) return renderDoc(doc, '내장 함수');
            if (target.kind === 'callee') return `\`\`\`tess\n${text}(…)\n\`\`\`\n\n선언을 찾지 못한 함수입니다.`;
        }
        if (STATE_VALUES.has(text)) {
            const doc = STATE_DOCS[text];
            return doc ? renderDoc(doc, '상태 값') : undefined;
        }
        if (OBJECT_PROPERTIES.has(text) || TEXT_ONLY_PROPERTIES.has(text)) {
            const doc = PROPERTY_DOCS[text];
            const title = TEXT_ONLY_PROPERTIES.has(text) ? '글상자 속성' : '오브젝트 속성';
            if (doc) return renderDoc(doc, title);
        }
        const keyword = STATEMENT_DOCS[text];
        if (keyword) return renderDoc(keyword, '키워드');

        if (target.kind === 'name') {
            return `\`\`\`tess\n${text}\n\`\`\`\n\n선언을 찾지 못한 이름입니다.`;
        }
        return undefined;
    }

    private symbolHover(symbol: TessSymbol): string {
        const label = KIND_LABELS[symbol.kind];
        const signature = symbol.kind === 'function'
            ? `function ${symbol.name}${symbol.detail ?? '()'}`
            : `${symbol.kind === 'list' ? 'list' : ''} ${symbol.name}`.trim();
        const owner = symbol.owner ? `\n\n오브젝트 \`${symbol.owner}\` 안에 선언되었습니다.` : '';
        const file = (symbol.kind === 'costume' || symbol.kind === 'sound') && symbol.detail
            ? `\n\n파일: \`${symbol.detail}\``
            : '';
        return `**${label}**\n\n\`\`\`tess\n${signature}\n\`\`\`${owner}${file}`;
    }
}
