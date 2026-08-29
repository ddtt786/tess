// ============================================================================
//  Completion
//
//  Driven by the token stream rather than the AST, so suggestions keep working
//  in a half typed file — which is when they are needed most.
// ============================================================================
import type { LangiumDocument, MaybePromise } from 'langium';
import type { CompletionList, CompletionParams } from 'vscode-languageserver';
import { CompletionItemKind, InsertTextFormat } from 'vscode-languageserver';
import type { CompletionItem } from 'vscode-languageserver-types';
import {
    BUILTIN_FUNCTIONS, OBJECT_PROPERTIES, OPTION_KEYWORDS, STATE_VALUES, TEXT_ONLY_PROPERTIES,
} from './tess-core.js';
import {
    BLOCK_SNIPPETS, EVENT_FORMS, FUNCTION_DOCS, PROPERTY_DOCS, STATE_DOCS, STATEMENT_DOCS,
    renderDoc,
} from './tess-docs.js';
import type { TessModel } from './tess-model.js';
import { modelOf } from './tess-model.js';
import type { TessSymbol } from './tess-symbols.js';

/** Keywords that open a statement rather than continue one. */
const STATEMENT_KEYWORDS = [
    'if', 'else', 'repeat', 'while', 'until', 'forever', 'wait', 'return', 'break', 'skip',
    'restart', 'stop', 'start', 'reset', 'clear', 'send', 'call', 'clone', 'del', 'kill',
    'jump', 'forward', 'bounce', 'move', 'go', 'turn', 'steer', 'look', 'show', 'hide',
    'next', 'prev', 'say', 'think', 'flip', 'order', 'write', 'append', 'prepend', 'stamp',
    'play', 'read', 'tts', 'ask', 'in', 'remove', 'var', 'list', 'end',
];

/** Keywords that may only appear at the top level of a file or a scene. */
const DECLARATION_KEYWORDS = ['project', 'scene', 'object', 'text', 'function', 'use', 'useobject', 'usetext', 'var', 'list'];

/** Keywords that belong inside an object body. */
const MEMBER_KEYWORDS = ['costume', 'default', 'sound', 'name', 'visible', 'lock', 'rotation', 'center', 'size', 'when', 'function', 'var', 'list'];

const SYMBOL_KINDS: Record<TessSymbol['kind'], CompletionItemKind> = {
    variable: CompletionItemKind.Variable,
    list: CompletionItemKind.Variable,
    function: CompletionItemKind.Function,
    param: CompletionItemKind.Variable,
    object: CompletionItemKind.Class,
    text: CompletionItemKind.Class,
    scene: CompletionItemKind.Module,
    costume: CompletionItemKind.Color,
    sound: CompletionItemKind.Event,
    signal: CompletionItemKind.Event,
};

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

export class TessCompletionProvider {
    getCompletion(document: LangiumDocument, params: CompletionParams): MaybePromise<CompletionList | undefined> {
        const model = modelOf(document);
        if (!model) return undefined;
        const offset = model.offsetAt(params.position);
        const items = this.collect(model, offset);
        return { isIncomplete: false, items };
    }

    private collect(model: TessModel, offset: number): CompletionItem[] {
        const before = previousToken(model, offset);
        const inString = isInsideString(model, offset);
        const items: CompletionItem[] = [];
        const seen = new Set<string>();
        const push = (item: CompletionItem) => {
            const key = `${item.kind}:${item.label}`;
            if (seen.has(key)) return;
            seen.add(key);
            items.push(item);
        };

        // Inside a literal only the names Tess spells as strings make sense.
        if (inString) {
            this.stringCompletions(model, before, push);
            return items;
        }

        if (before?.image === 'when') {
            for (const form of EVENT_FORMS) {
                push({
                    label: form.label,
                    kind: CompletionItemKind.Event,
                    insertText: form.insert.replace(/^when /, ''),
                    insertTextFormat: InsertTextFormat.Snippet,
                    documentation: { kind: 'markdown', value: form.summary },
                    sortText: `0${form.label}`,
                });
            }
            return items;
        }

        if (before?.image === 'jump') {
            for (const word of ['next', 'back']) {
                push({ label: word, kind: CompletionItemKind.Keyword, detail: '이웃 장면' });
            }
            for (const scene of model.symbols.outline.filter((s) => s.kind === 'scene')) {
                push({
                    label: `"${scene.name}"`,
                    kind: CompletionItemKind.Module,
                    detail: '장면',
                    filterText: scene.name,
                });
            }
            return items;
        }

        if (before?.image === 'rotation') {
            for (const word of ['free', 'vertical', 'none']) {
                push({ label: word, kind: CompletionItemKind.EnumMember, detail: '회전 방식' });
            }
            return items;
        }

        if (before?.image === 'order') {
            for (const word of ['front', 'back', 'first', 'last']) {
                push({ label: word, kind: CompletionItemKind.EnumMember, detail: '그리는 순서' });
            }
            return items;
        }

        const position = this.positionKind(model, offset, before);

        if (position === 'top-level') {
            for (const word of DECLARATION_KEYWORDS) this.keyword(word, push, '0');
            for (const snippet of BLOCK_SNIPPETS) this.snippet(snippet, push);
            return items;
        }

        if (position === 'object-member') {
            for (const word of MEMBER_KEYWORDS) this.keyword(word, push, '0');
            for (const form of EVENT_FORMS) {
                push({
                    label: form.label,
                    kind: CompletionItemKind.Event,
                    insertText: form.insert,
                    insertTextFormat: InsertTextFormat.Snippet,
                    documentation: { kind: 'markdown', value: form.summary },
                    sortText: `1${form.label}`,
                });
            }
            const properties = model.symbols.isTextContext(offset)
                ? [...OBJECT_PROPERTIES, ...TEXT_ONLY_PROPERTIES]
                : [...OBJECT_PROPERTIES];
            for (const name of properties) this.property(name, push);
            return items;
        }

        if (position === 'statement') {
            for (const word of STATEMENT_KEYWORDS) this.keyword(word, push, '1');
            for (const snippet of BLOCK_SNIPPETS) this.snippet(snippet, push);
            const properties = model.symbols.isTextContext(offset)
                ? [...OBJECT_PROPERTIES, ...TEXT_ONLY_PROPERTIES]
                : [...OBJECT_PROPERTIES];
            for (const name of properties) this.property(name, push);
        }

        // Expression position: everything that can produce a value.
        for (const symbol of model.symbols.visibleSymbols(offset)) this.symbol(symbol, push);
        for (const name of BUILTIN_FUNCTIONS) this.builtin(name, push);
        for (const name of STATE_VALUES) this.state(name, push);
        for (const name of OPTION_KEYWORDS) {
            push({ label: name, kind: CompletionItemKind.EnumMember, detail: '색 성분', sortText: `5${name}` });
        }
        for (const word of ['true', 'false', 'not', 'and', 'or', 'transparent']) {
            this.keyword(word, push, '4');
        }
        return items;
    }

    /** Whether a statement, a declaration or an expression belongs here. */
    private positionKind(
        model: TessModel,
        offset: number,
        before: ReturnType<typeof previousToken>,
    ): 'top-level' | 'object-member' | 'statement' | 'expression' {
        // Anything other than a line break or a block opener means we are in the
        // middle of a command, where only a value may follow.
        if (before && !opensLine(model, before, offset)) return 'expression';
        const scope = model.symbols.scopeAt(offset);
        if (scope.kind === 'global') return 'top-level';
        if (scope.kind === 'object') return 'object-member';
        return 'statement';
    }

    private stringCompletions(
        model: TessModel,
        before: ReturnType<typeof previousToken>,
        push: (item: CompletionItem) => void,
    ): void {
        if (!before) return;
        const word = before.image;
        if (word === 'signal' || word === 'send' || word === 'call') {
            for (const signal of model.symbols.signals) {
                push({ label: signal, kind: CompletionItemKind.Event, detail: '신호' });
            }
            return;
        }
        if (word === 'jump') {
            for (const scene of model.symbols.outline.filter((s) => s.kind === 'scene')) {
                push({ label: scene.name, kind: CompletionItemKind.Module, detail: '장면' });
            }
            return;
        }
        if (word === 'costume') {
            for (const costume of model.symbols.membersAt(before.startOffset, 'costume')) {
                push({ label: costume.name, kind: CompletionItemKind.Color, detail: '모양' });
            }
            return;
        }
        if (word === 'sound') {
            for (const sound of model.symbols.membersAt(before.startOffset, 'sound')) {
                push({ label: sound.name, kind: CompletionItemKind.Event, detail: '소리' });
            }
            return;
        }
        // Every other string argument names an object: `look`, `touching`, `go`.
        for (const object of model.symbols.outline.filter((s) => s.kind === 'object' || s.kind === 'text')) {
            push({ label: object.name, kind: CompletionItemKind.Class, detail: '오브젝트' });
        }
    }

    private keyword(word: string, push: (item: CompletionItem) => void, order: string): void {
        const doc = STATEMENT_DOCS[word];
        push({
            label: word,
            kind: CompletionItemKind.Keyword,
            detail: doc?.signature,
            documentation: doc ? { kind: 'markdown', value: renderDoc(doc) } : undefined,
            sortText: `${order}${word}`,
        });
    }

    private snippet(
        snippet: { label: string; insert: string; summary: string },
        push: (item: CompletionItem) => void,
    ): void {
        push({
            label: `${snippet.label} …`,
            kind: CompletionItemKind.Snippet,
            insertText: snippet.insert,
            insertTextFormat: InsertTextFormat.Snippet,
            filterText: snippet.label,
            documentation: { kind: 'markdown', value: snippet.summary },
            sortText: `0${snippet.label}`,
        });
    }

    private symbol(symbol: TessSymbol, push: (item: CompletionItem) => void): void {
        push({
            label: symbol.name,
            kind: SYMBOL_KINDS[symbol.kind],
            detail: `${KIND_LABELS[symbol.kind]}${symbol.detail ? ` ${symbol.detail}` : ''}`,
            insertText: symbol.kind === 'function' ? `${symbol.name}($0)` : undefined,
            insertTextFormat: symbol.kind === 'function' ? InsertTextFormat.Snippet : undefined,
            sortText: `2${symbol.name}`,
        });
    }

    private builtin(name: string, push: (item: CompletionItem) => void): void {
        const doc = FUNCTION_DOCS[name];
        push({
            label: name,
            kind: CompletionItemKind.Function,
            detail: doc?.signature ?? '내장 함수',
            documentation: doc ? { kind: 'markdown', value: renderDoc(doc) } : undefined,
            insertText: `${name}($0)`,
            insertTextFormat: InsertTextFormat.Snippet,
            sortText: `3${name}`,
        });
    }

    private state(name: string, push: (item: CompletionItem) => void): void {
        const doc = STATE_DOCS[name];
        push({
            label: name,
            kind: CompletionItemKind.Constant,
            detail: doc?.signature ?? '상태 값',
            documentation: doc ? { kind: 'markdown', value: renderDoc(doc) } : undefined,
            sortText: `3${name}`,
        });
    }

    private property(name: string, push: (item: CompletionItem) => void): void {
        const doc = PROPERTY_DOCS[name];
        push({
            label: name,
            kind: CompletionItemKind.Property,
            detail: doc?.signature ?? '속성',
            documentation: doc ? { kind: 'markdown', value: renderDoc(doc) } : undefined,
            sortText: `2${name}`,
        });
    }
}

/** The last token that ends before the cursor, ignoring the word being typed. */
function previousToken(model: TessModel, offset: number) {
    let found: (typeof model.tokens)[number] | undefined;
    for (const token of model.tokens) {
        if (token.startOffset >= offset) break;
        // The partially typed word under the cursor is not context, it is the query.
        if (token.endOffset + 1 >= offset) break;
        found = token;
    }
    return found;
}

/** True when nothing but a block opener or a line break stands before the cursor. */
function opensLine(model: TessModel, before: NonNullable<ReturnType<typeof previousToken>>, offset: number): boolean {
    if ([':', 'then', 'do', 'end', 'else'].includes(before.image)) return true;
    return model.text.slice(before.endOffset + 1, offset).includes('\n');
}

function isInsideString(model: TessModel, offset: number): boolean {
    const line = model.text.slice(model.text.lastIndexOf('\n', offset - 1) + 1, offset);
    let open = false;
    for (let i = 0; i < line.length; i += 1) {
        if (line[i] === '\\') { i += 1; continue; }
        if (line[i] === '"') open = !open;
        if (!open && line[i] === '#') return false;
    }
    return open;
}
