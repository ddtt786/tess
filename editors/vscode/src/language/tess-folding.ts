// ============================================================================
//  Folding
//
//  Every `… end` block folds, and so does a run of comment lines.
// ============================================================================
import type { LangiumDocument, MaybePromise } from 'langium';
import type { FoldingRange, FoldingRangeParams } from 'vscode-languageserver';
import { FoldingRangeKind } from 'vscode-languageserver';
import type { AstNode } from 'langium';
import { childNodes, modelOf } from './tess-model.js';

/** AST types written as a block that closes with `end`. */
const BLOCKS = new Set([
    'Project', 'Scene', 'ObjectDecl', 'FunctionDecl', 'Event',
    'If', 'Repeat', 'While', 'Until', 'Forever',
]);

export class TessFoldingRangeProvider {
    getFoldingRanges(document: LangiumDocument, _params: FoldingRangeParams): MaybePromise<FoldingRange[]> {
        const model = modelOf(document);
        if (!model) return [];
        const ranges: FoldingRange[] = [];

        const visit = (node: AstNode): void => {
            if (BLOCKS.has(node.$type) && node.$cstNode) {
                const { start, end } = node.$cstNode.range;
                if (end.line > start.line) {
                    ranges.push({ startLine: start.line, endLine: end.line - 1 });
                }
            }
            for (const child of childNodes(node)) visit(child);
        };
        visit(model.root);
        ranges.push(...commentRanges(model.text));
        return ranges;
    }
}

/** Groups neighbouring comment lines into one foldable region. */
function commentRanges(text: string): FoldingRange[] {
    const lines = text.split('\n');
    const ranges: FoldingRange[] = [];
    let start = -1;
    for (let i = 0; i < lines.length; i += 1) {
        const isComment = /^\s*#/.test(lines[i]) && !/^\s*#[0-9a-fA-F]{6}\b/.test(lines[i]);
        if (isComment) {
            if (start < 0) start = i;
        } else if (start >= 0) {
            if (i - 1 > start) ranges.push({ startLine: start, endLine: i - 1, kind: FoldingRangeKind.Comment });
            start = -1;
        }
    }
    if (start >= 0 && lines.length - 1 > start) {
        ranges.push({ startLine: start, endLine: lines.length - 1, kind: FoldingRangeKind.Comment });
    }
    return ranges;
}
