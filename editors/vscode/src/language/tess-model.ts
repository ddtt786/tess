// ============================================================================
//  Per document analysis shared by every language service
//
//  Built once per parse and cached on the AST root, so a completion request and
//  the hover that follows it read the same symbol table.
// ============================================================================
import type { AstNode, CstNode, LangiumDocument } from 'langium';
import { CstUtils } from 'langium';
import type { Range } from 'vscode-languageserver';
import type { TessToken } from './tess-core.js';
import { BUILTIN_FUNCTIONS, isKeywordToken, isNameToken } from './tess-core.js';
import type { TessParseInfo } from './tess-bridge.js';
import { getParseInfo } from './tess-bridge.js';
import type { TessSymbol } from './tess-symbols.js';
import { IMPLICIT_NAMES, TessSymbolTable } from './tess-symbols.js';

/** What the cursor is sitting on. */
export type TargetKind = 'name' | 'callee' | 'declaration' | 'keyword' | 'string' | 'none';

export interface Target {
    kind: TargetKind;
    /** The written text, with quotes stripped for a string literal. */
    text: string;
    range: Range;
    offset: number;
    token: TessToken;
    node?: AstNode;
    symbol?: TessSymbol;
}

export class TessModel {
    readonly symbols: TessSymbolTable;
    private declarations?: Map<string, TessSymbol>;

    constructor(readonly info: TessParseInfo, readonly root: AstNode) {
        this.symbols = new TessSymbolTable(info, root);
    }

    get text(): string {
        return this.info.text;
    }

    get tokens(): TessToken[] {
        return this.info.tokens;
    }

    offsetAt(position: { line: number; character: number }): number {
        return this.symbols.index.offsetAt(position);
    }

    /** The token containing `offset`, or the one that ends exactly there. */
    tokenAt(offset: number): TessToken | undefined {
        const tokens = this.tokens;
        let low = 0;
        let high = tokens.length - 1;
        while (low <= high) {
            const mid = (low + high) >> 1;
            const token = tokens[mid];
            if (offset < token.startOffset) high = mid - 1;
            else if (offset > token.endOffset + 1) low = mid + 1;
            else return token;
        }
        return undefined;
    }

    /** The innermost AST node whose CST covers `offset`. */
    nodeAt(offset: number): AstNode | undefined {
        const cst = this.root.$cstNode;
        if (!cst) return undefined;
        const leaf: CstNode | undefined = CstUtils.findLeafNodeAtOffset(cst, offset);
        try {
            return leaf?.astNode;
        } catch {
            return undefined;
        }
    }

    /** Classifies what the cursor points at, which every navigation service needs. */
    targetAt(offset: number): Target | undefined {
        const token = this.tokenAt(offset) ?? this.tokenAt(Math.max(offset - 1, 0));
        if (!token) return undefined;
        const range = this.symbols.tokenRange(token);
        const node = this.nodeAt(token.startOffset);

        if (token.image.startsWith('"')) {
            return {
                kind: 'string',
                text: token.image.slice(1, -1).replace(/\\(.)/g, '$1'),
                range,
                offset: token.startOffset,
                token,
                node,
            };
        }

        if (!isNameToken(token)) {
            return {
                kind: 'keyword', text: token.image, range, offset: token.startOffset, token, node,
            };
        }

        const declaration = this.declarationAt(token);
        if (declaration) {
            return {
                kind: 'declaration',
                text: token.image,
                range,
                offset: token.startOffset,
                token,
                node,
                symbol: declaration,
            };
        }

        const isCallee = node?.$type === 'Call'
            && (node as unknown as { callee?: string }).callee === token.image
            && node.$cstNode?.offset === token.startOffset;

        if (node?.$type === 'Identifier' || isCallee) {
            return {
                kind: isCallee ? 'callee' : 'name',
                text: token.image,
                range,
                offset: token.startOffset,
                token,
                node,
                symbol: this.symbols.resolve(token.image, token.startOffset),
            };
        }

        // A keyword doubling as a name still deserves its reference documentation.
        if (isKeywordToken(token)) {
            return {
                kind: 'keyword', text: token.image, range, offset: token.startOffset, token, node,
            };
        }
        return {
            kind: 'none', text: token.image, range, offset: token.startOffset, token, node,
        };
    }

    /** The declaration this token spells out, if it is the declaring name. */
    private declarationAt(token: TessToken): TessSymbol | undefined {
        if (!this.declarations) {
            this.declarations = new Map();
            for (const symbol of this.symbols.allSymbols()) {
                this.declarations.set(positionKey(symbol.nameRange), symbol);
            }
        }
        return this.declarations.get(positionKey(this.symbols.tokenRange(token)));
    }

    /**
     * Every place the symbol is written, the declaration included. Names that
     * resolve elsewhere are left alone, so a shadowed local stays untouched.
     */
    occurrences(symbol: TessSymbol): Range[] {
        const ranges: Range[] = [symbol.nameRange];
        const visit = (node: AstNode): void => {
            const cst = node.$cstNode;
            if (node.$type === 'Identifier' && cst) {
                const name = (node as unknown as { name?: string }).name;
                if (name === symbol.name && this.symbols.resolve(name, cst.offset) === symbol) {
                    ranges.push(cst.range);
                }
            } else if (node.$type === 'Call' && cst) {
                const callee = (node as unknown as { callee?: string }).callee;
                if (callee === symbol.name && this.symbols.resolve(callee, cst.offset) === symbol) {
                    ranges.push({
                        start: cst.range.start,
                        end: this.symbols.index.positionAt(cst.offset + callee.length),
                    });
                }
            }
            for (const child of childNodes(node)) visit(child);
        };
        if (this.info.parsed) visit(this.root);
        return dedupe(ranges);
    }

    /** True when the name is legal without a declaration. */
    isFreeName(name: string): boolean {
        return IMPLICIT_NAMES.has(name) || BUILTIN_FUNCTIONS.has(name);
    }
}

const positionKey = (range: Range): string =>
    `${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}`;

function dedupe(ranges: Range[]): Range[] {
    const seen = new Set<string>();
    const out: Range[] = [];
    for (const range of ranges) {
        const key = positionKey(range);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(range);
    }
    return out.sort((a, b) => a.start.line - b.start.line || a.start.character - b.start.character);
}

/** Direct AST children of a node, skipping the `$` bookkeeping properties. */
export function childNodes(node: AstNode): AstNode[] {
    const out: AstNode[] = [];
    for (const [key, value] of Object.entries(node)) {
        if (key.startsWith('$')) continue;
        if (Array.isArray(value)) {
            for (const item of value) if (isAst(item)) out.push(item);
        } else if (isAst(value)) {
            out.push(value);
        }
    }
    return out;
}

const isAst = (value: unknown): value is AstNode =>
    typeof value === 'object' && value !== null && typeof (value as AstNode).$type === 'string';

const models = new WeakMap<AstNode, TessModel>();

/** The analysis for a document, or `undefined` if it was not parsed by Tess. */
export function modelOf(document: LangiumDocument): TessModel | undefined {
    const root = document.parseResult?.value;
    if (!root) return undefined;
    const cached = models.get(root);
    if (cached) return cached;
    const info = getParseInfo(root);
    if (!info) return undefined;
    const model = new TessModel(info, root);
    models.set(root, model);
    return model;
}
