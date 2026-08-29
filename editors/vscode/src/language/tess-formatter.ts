// ============================================================================
//  Formatting
//
//  Re-indents by block depth only. Tess lines are otherwise written by hand, so
//  nothing else on a line is touched — formatting never rewrites code.
// ============================================================================
import type { LangiumDocument, MaybePromise } from 'langium';
import type {
    DocumentFormattingParams, DocumentOnTypeFormattingOptions, DocumentOnTypeFormattingParams,
    DocumentRangeFormattingParams, Range, TextEdit,
} from 'vscode-languageserver';
import type { TessToken } from './tess-core.js';
import { modelOf } from './tess-model.js';

/** Words that open a block; each is the last token on its line. */
const OPENERS = new Set([':', 'then', 'do']);

export class TessFormatter {
    formatDocument(document: LangiumDocument, params: DocumentFormattingParams): MaybePromise<TextEdit[]> {
        return this.edits(document, params.options.insertSpaces !== false, params.options.tabSize ?? 2);
    }

    formatDocumentRange(document: LangiumDocument, params: DocumentRangeFormattingParams): MaybePromise<TextEdit[]> {
        const all = this.edits(document, params.options.insertSpaces !== false, params.options.tabSize ?? 2);
        return all.filter((edit) => edit.range.start.line >= params.range.start.line
            && edit.range.start.line <= params.range.end.line);
    }

    formatDocumentOnType(_document: LangiumDocument, _params: DocumentOnTypeFormattingParams): MaybePromise<TextEdit[]> {
        return [];
    }

    get formatOnTypeOptions(): DocumentOnTypeFormattingOptions | undefined {
        return undefined;
    }

    private edits(document: LangiumDocument, spaces: boolean, width: number): TextEdit[] {
        const model = modelOf(document);
        if (!model) return [];
        const lines = model.text.split('\n');
        const unit = spaces ? ' '.repeat(Math.max(width, 1)) : '\t';

        const starts = new Map<number, TessToken[]>();
        const inside = new Set<number>();
        for (const token of model.tokens) {
            const line = token.startLine - 1;
            const list = starts.get(line);
            if (list) list.push(token);
            else starts.set(line, [token]);
            // A string may span lines; its continuation is content, not code.
            for (let i = line + 1; i <= token.endLine - 1; i += 1) inside.add(i);
        }

        const edits: TextEdit[] = [];
        let depth = 0;
        for (let line = 0; line < lines.length; line += 1) {
            const text = lines[line];
            if (inside.has(line)) continue;

            const tokens = starts.get(line);
            if (!tokens) {
                // Blank and comment only lines follow the depth they sit at.
                pushEdit(edits, line, text, unit.repeat(depth));
                continue;
            }

            const first = tokens[0].image;
            const closes = first === 'end' || first === 'else';
            const indent = Math.max(closes ? depth - 1 : depth, 0);
            pushEdit(edits, line, text, unit.repeat(indent));

            if (closes) depth = Math.max(depth - 1, 0);
            if (OPENERS.has(tokens[tokens.length - 1].image)) depth += 1;
        }
        return edits;
    }
}

/** Replaces the leading whitespace of a line, but only when it differs. */
function pushEdit(edits: TextEdit[], line: number, text: string, wanted: string): void {
    const current = /^[ \t]*/.exec(text)![0];
    // A blank line carries no content to line up, and keeps its line ending.
    const blank = text.slice(current.length).replace(/\r$/, '') === '';
    const target = blank ? '' : wanted;
    if (current === target) return;
    const range: Range = {
        start: { line, character: 0 },
        end: { line, character: current.length },
    };
    edits.push({ range, newText: target });
}
