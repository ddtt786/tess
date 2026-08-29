// ============================================================================
//  Tess symbol table
//
//  Mirrors the scoping rules the compiler's validator enforces (spec 14.2):
//  globals are the top level `var` and `list` declarations, an object's own
//  declarations are visible to its event scripts only, and a function sees its
//  parameters and the globals but never the enclosing object's locals.
// ============================================================================
import type { AstNode } from 'langium';
import type { Position, Range } from 'vscode-languageserver';
import type { TessToken } from './tess-core.js';
import {
    BUILTIN_FUNCTIONS, OBJECT_PROPERTIES, OPTION_KEYWORDS, STATE_VALUES, TEXT_ONLY_PROPERTIES,
} from './tess-core.js';
import type { TessParseInfo } from './tess-bridge.js';

export type SymbolKind =
    | 'variable' | 'list' | 'function' | 'param'
    | 'object' | 'text' | 'scene' | 'costume' | 'sound' | 'signal';

export interface TessSymbol {
    name: string;
    kind: SymbolKind;
    /** Span of the declared name alone, for rename and go-to-definition. */
    nameRange: Range;
    /** Span of the whole declaration, for the outline. */
    range: Range;
    node?: AstNode;
    /** Name of the object a member belongs to. */
    owner?: string;
    detail?: string;
    children?: TessSymbol[];
}

export type ScopeKind = 'global' | 'object' | 'function' | 'event';

export interface TessScope {
    kind: ScopeKind;
    start: number;
    end: number;
    /** Declarations this scope introduces, latest wins. */
    symbols: Map<string, TessSymbol>;
    parent?: TessScope;
    children: TessScope[];
    /** Set on object scopes; text boxes accept the text-only properties. */
    isText?: boolean;
    /** Object locals, kept visible to event scripts but hidden from functions. */
    objectLocals?: Map<string, TessSymbol>;
}

/** Maps offsets to LSP positions without rescanning the file each time. */
export class TextIndex {
    private readonly starts: number[] = [0];

    constructor(private readonly text: string) {
        for (let i = 0; i < text.length; i += 1) {
            if (text.charCodeAt(i) === 10) this.starts.push(i + 1);
        }
    }

    positionAt(offset: number): Position {
        const target = Math.min(Math.max(offset, 0), this.text.length);
        let low = 0;
        let high = this.starts.length - 1;
        while (low < high) {
            const mid = (low + high + 1) >> 1;
            if (this.starts[mid] <= target) low = mid;
            else high = mid - 1;
        }
        return { line: low, character: target - this.starts[low] };
    }

    offsetAt(position: Position): number {
        const line = Math.min(Math.max(position.line, 0), this.starts.length - 1);
        const start = this.starts[line];
        const next = line + 1 < this.starts.length ? this.starts[line + 1] : this.text.length + 1;
        return Math.min(start + Math.max(position.character, 0), next - 1);
    }

    rangeOf(start: number, end: number): Range {
        return { start: this.positionAt(start), end: this.positionAt(end) };
    }
}

const nodeSpan = (node: AstNode): { start: number; end: number } | undefined => {
    const cst = node.$cstNode;
    if (!cst) return undefined;
    return { start: cst.offset, end: cst.end };
};

/** Names that are always in scope without a declaration. */
export const IMPLICIT_NAMES = new Set<string>([
    ...STATE_VALUES, ...OPTION_KEYWORDS, ...OBJECT_PROPERTIES, ...TEXT_ONLY_PROPERTIES,
]);

export class TessSymbolTable {
    readonly root: TessScope;
    readonly index: TextIndex;
    /** Every function name in the file — Tess resolves calls across objects. */
    readonly functions = new Map<string, TessSymbol>();
    /** Outline entries, in source order. */
    readonly outline: TessSymbol[] = [];
    /** Signal names seen in `when signal` and `send`, for completion. */
    readonly signals = new Set<string>();
    /** Files pulled in with `use`, mapped to the range of the path literal. */
    readonly uses: Array<{ path: string; range: Range }> = [];

    private readonly tokens: TessToken[];

    constructor(info: TessParseInfo, program: AstNode | undefined) {
        this.index = new TextIndex(info.text);
        this.tokens = info.tokens;
        this.root = {
            kind: 'global', start: 0, end: info.text.length, symbols: new Map(), children: [],
        };
        if (program && info.parsed) this.collectProgram(program);
        else this.collectFromTokens();
    }

    // ------------------------------------------------------------------
    //  Lookup
    // ------------------------------------------------------------------

    /** The innermost scope containing `offset`. */
    scopeAt(offset: number): TessScope {
        let scope = this.root;
        for (;;) {
            const next = scope.children.find((child) => offset >= child.start && offset <= child.end);
            if (!next) return scope;
            scope = next;
        }
    }

    /** Resolves a name the way the validator would at this position. */
    resolve(name: string, offset: number): TessSymbol | undefined {
        for (let scope: TessScope | undefined = this.scopeAt(offset); scope; scope = scope.parent) {
            const found = scope.symbols.get(name);
            if (found) return found;
            // An object's locals reach its event scripts but not its functions.
            if (scope.kind === 'event') {
                const local = scope.parent?.objectLocals?.get(name);
                if (local) return local;
            }
        }
        return this.functions.get(name);
    }

    /** Every name that may be written at this position, nearest scope first. */
    visibleSymbols(offset: number): TessSymbol[] {
        const seen = new Map<string, TessSymbol>();
        const add = (symbol: TessSymbol) => {
            if (!seen.has(symbol.name)) seen.set(symbol.name, symbol);
        };
        for (let scope: TessScope | undefined = this.scopeAt(offset); scope; scope = scope.parent) {
            for (const symbol of scope.symbols.values()) {
                if (symbol.kind !== 'costume' && symbol.kind !== 'sound') add(symbol);
            }
            if (scope.kind === 'event') {
                for (const symbol of scope.parent?.objectLocals?.values() ?? []) add(symbol);
            }
        }
        for (const symbol of this.functions.values()) add(symbol);
        return [...seen.values()];
    }

    /** Assets declared on the object enclosing `offset`. */
    membersAt(offset: number, kind: 'costume' | 'sound'): TessSymbol[] {
        for (let scope: TessScope | undefined = this.scopeAt(offset); scope; scope = scope.parent) {
            if (scope.kind !== 'object') continue;
            return [...scope.symbols.values()].filter((symbol) => symbol.kind === kind);
        }
        return [];
    }

    /** True when the scope at `offset` belongs to a text box. */
    isTextContext(offset: number): boolean {
        for (let scope: TessScope | undefined = this.scopeAt(offset); scope; scope = scope.parent) {
            if (scope.isText !== undefined) return scope.isText;
        }
        return false;
    }

    /** Every declaration in the file, for rename and workspace symbols. */
    allSymbols(): TessSymbol[] {
        const out: TessSymbol[] = [...this.functions.values()];
        const walk = (scope: TessScope) => {
            out.push(...scope.symbols.values());
            if (scope.objectLocals) out.push(...scope.objectLocals.values());
            scope.children.forEach(walk);
        };
        walk(this.root);
        const walkOutline = (entries: TessSymbol[]) => {
            for (const entry of entries) {
                out.push(entry);
                if (entry.children) walkOutline(entry.children);
            }
        };
        walkOutline(this.outline);
        return out;
    }

    // ------------------------------------------------------------------
    //  Collection
    // ------------------------------------------------------------------

    private collectProgram(program: AstNode): void {
        const body = (program as unknown as { body?: AstNode[] }).body ?? [];
        this.collectFunctionNames(body);
        for (const item of body) this.collectTopLevel(item, this.root, this.outline);
    }

    /** Function names resolve across the whole file, objects and scenes included. */
    private collectFunctionNames(body: AstNode[]): void {
        for (const member of body) {
            if (member.$type === 'FunctionDecl') {
                const symbol = this.declaration(member, 'function');
                if (symbol) this.functions.set(symbol.name, symbol);
            }
            if (member.$type === 'Scene' || member.$type === 'ObjectDecl') {
                this.collectFunctionNames((member as unknown as { body?: AstNode[] }).body ?? []);
            }
        }
    }

    private collectTopLevel(item: AstNode, scope: TessScope, outline: TessSymbol[]): void {
        switch (item.$type) {
            case 'VarDecl':
            case 'ListDecl': {
                const symbol = this.declaration(item, item.$type === 'ListDecl' ? 'list' : 'variable');
                if (symbol) {
                    scope.symbols.set(symbol.name, symbol);
                    outline.push(symbol);
                }
                break;
            }
            case 'FunctionDecl':
                this.collectFunction(item, scope, undefined, outline);
                break;
            case 'Scene': {
                const symbol = this.declaration(item, 'scene');
                const children: TessSymbol[] = [];
                if (symbol) {
                    symbol.children = children;
                    outline.push(symbol);
                }
                for (const member of (item as unknown as { body?: AstNode[] }).body ?? []) {
                    this.collectTopLevel(member, scope, symbol ? children : outline);
                }
                break;
            }
            case 'ObjectDecl':
                this.collectObject(item, scope, outline);
                break;
            case 'Use':
            case 'UseObject': {
                const span = nodeSpan(item);
                const path = (item as unknown as { path?: string }).path;
                if (span && typeof path === 'string') {
                    this.uses.push({ path, range: this.stringRange(span, path) });
                }
                break;
            }
            default:
                break;
        }
    }

    private collectObject(object: AstNode, parent: TessScope, outline: TessSymbol[]): void {
        const span = nodeSpan(object);
        const isText = (object as unknown as { kind?: string }).kind === 'text';
        const symbol = this.declaration(object, isText ? 'text' : 'object');
        if (symbol) outline.push(symbol);
        if (!span) return;

        const scope: TessScope = {
            kind: 'object',
            start: span.start,
            end: span.end,
            symbols: new Map(),
            parent,
            children: [],
            isText,
            objectLocals: new Map(),
        };
        parent.children.push(scope);

        const children: TessSymbol[] = [];
        for (const member of (object as unknown as { body?: AstNode[] }).body ?? []) {
            switch (member.$type) {
                case 'VarDecl':
                case 'ListDecl': {
                    const local = this.declaration(member, member.$type === 'ListDecl' ? 'list' : 'variable');
                    if (local) {
                        local.owner = symbol?.name;
                        scope.objectLocals!.set(local.name, local);
                        children.push(local);
                    }
                    break;
                }
                case 'Costume':
                case 'Sound': {
                    const kind = member.$type === 'Costume' ? 'costume' : 'sound';
                    const asset = this.assetDeclaration(member, kind);
                    if (asset) {
                        asset.owner = symbol?.name;
                        scope.symbols.set(`${kind}:${asset.name}`, asset);
                        children.push(asset);
                    }
                    break;
                }
                case 'FunctionDecl': {
                    const fn = this.collectFunction(member, scope, symbol?.name, children);
                    if (fn) children.push(fn);
                    break;
                }
                case 'Event':
                    this.collectEvent(member, scope);
                    break;
                default:
                    break;
            }
        }
        if (symbol) symbol.children = children;
    }

    private collectFunction(
        fn: AstNode,
        parent: TessScope,
        owner: string | undefined,
        outline: TessSymbol[],
    ): TessSymbol | undefined {
        const span = nodeSpan(fn);
        const declared = (fn as unknown as { name?: string }).name ?? '';
        const symbol = this.functions.get(declared) ?? this.declaration(fn, 'function');
        const params = (fn as unknown as { params?: string[] }).params ?? [];
        if (symbol) {
            symbol.owner = owner;
            symbol.detail = `(${params.join(', ')})`;
            if (!owner) outline.push(symbol);
        }
        if (!span) return symbol;

        // A function's own scope starts empty; parameters are its only inheritance.
        const scope: TessScope = {
            kind: 'function', start: span.start, end: span.end, symbols: new Map(), parent, children: [],
        };
        parent.children.push(scope);

        const booleans = new Set((fn as unknown as { booleanParams?: string[] }).booleanParams ?? []);
        for (const name of params) {
            const range = this.findNameRange(span.start, span.end, name);
            if (!range) continue;
            scope.symbols.set(name, {
                name,
                kind: 'param',
                nameRange: range,
                range,
                node: fn,
                detail: booleans.has(name) ? '판단 매개변수' : '매개변수',
            });
        }
        this.collectStatements((fn as unknown as { body?: AstNode[] }).body ?? [], scope);
        return symbol;
    }

    private collectEvent(event: AstNode, parent: TessScope): void {
        const span = nodeSpan(event);
        const signal = (event as unknown as { signal?: string }).signal;
        if (typeof signal === 'string') this.signals.add(signal);
        if (!span) return;
        const scope: TessScope = {
            kind: 'event', start: span.start, end: span.end, symbols: new Map(), parent, children: [],
        };
        parent.children.push(scope);
        this.collectStatements((event as unknown as { body?: AstNode[] }).body ?? [], scope);
    }

    /** Adds block local declarations; Tess scopes them to the whole script. */
    private collectStatements(statements: AstNode[], scope: TessScope): void {
        for (const statement of statements) {
            switch (statement.$type) {
                case 'VarDecl':
                case 'ListDecl': {
                    const local = this.declaration(
                        statement,
                        statement.$type === 'ListDecl' ? 'list' : 'variable',
                    );
                    if (local) scope.symbols.set(local.name, local);
                    break;
                }
                case 'Send': {
                    const value = (statement as unknown as { signal?: AstNode }).signal;
                    if (value?.$type === 'StringLiteral') {
                        const name = (value as unknown as { value?: string }).value;
                        if (typeof name === 'string') this.signals.add(name);
                    }
                    break;
                }
                default:
                    break;
            }
            for (const key of ['body', 'consequent', 'alternate'] as const) {
                const block = (statement as unknown as Record<string, unknown>)[key];
                if (Array.isArray(block)) this.collectStatements(block as AstNode[], scope);
            }
        }
    }

    // ------------------------------------------------------------------
    //  Ranges
    // ------------------------------------------------------------------

    private declaration(node: AstNode, kind: SymbolKind): TessSymbol | undefined {
        const span = nodeSpan(node);
        const name = (node as unknown as { name?: string }).name;
        if (!span || typeof name !== 'string') return undefined;
        const nameRange = (kind === 'object' || kind === 'text' || kind === 'scene')
            ? this.stringRange(span, name)
            : this.findNameRange(span.start, span.end, name) ?? this.index.rangeOf(span.start, span.end);
        return {
            name, kind, nameRange, range: this.index.rangeOf(span.start, span.end), node,
        };
    }

    private assetDeclaration(node: AstNode, kind: 'costume' | 'sound'): TessSymbol | undefined {
        const span = nodeSpan(node);
        const id = (node as unknown as { id?: string }).id;
        const file = (node as unknown as { file?: string }).file;
        if (!span || typeof id !== 'string') return undefined;
        const nameRange = this.findNameRange(span.start, span.end, id)
            ?? this.index.rangeOf(span.start, span.end);
        return {
            name: id,
            kind,
            nameRange,
            range: this.index.rangeOf(span.start, span.end),
            node,
            detail: file,
        };
    }

    /** Index of the first token starting at or after `offset`. */
    private tokenIndexAt(offset: number): number {
        let low = 0;
        let high = this.tokens.length;
        while (low < high) {
            const mid = (low + high) >> 1;
            if (this.tokens[mid].startOffset < offset) low = mid + 1;
            else high = mid;
        }
        return low;
    }

    /** Locates the token that spells `name` inside a declaration. */
    private findNameRange(start: number, end: number, name: string): Range | undefined {
        for (let i = this.tokenIndexAt(start); i < this.tokens.length; i += 1) {
            const token = this.tokens[i];
            if (token.startOffset >= end) break;
            if (token.image === name) return this.tokenRange(token);
        }
        return undefined;
    }

    /** Locates the string literal holding `value` inside a declaration. */
    private stringRange(span: { start: number; end: number }, value: string): Range {
        for (let i = this.tokenIndexAt(span.start); i < this.tokens.length; i += 1) {
            const token = this.tokens[i];
            if (token.startOffset >= span.end) break;
            if (token.image.startsWith('"') && token.image.slice(1, -1).replace(/\\(.)/g, '$1') === value) {
                return this.tokenRange(token);
            }
        }
        return this.index.rangeOf(span.start, span.end);
    }

    tokenRange(token: TessToken): Range {
        return {
            start: { line: token.startLine - 1, character: token.startColumn - 1 },
            end: { line: token.endLine - 1, character: token.endColumn },
        };
    }

    // ------------------------------------------------------------------
    //  Fallback while the file does not parse
    // ------------------------------------------------------------------

    /**
     * Reads declarations and block nesting straight off the token stream. A half
     * typed file has no AST, and completion is exactly what the reader needs at
     * that moment.
     */
    private collectFromTokens(): void {
        const kinds: Record<string, SymbolKind> = { var: 'variable', list: 'list', function: 'function' };
        // Blocks the reader is inside, innermost last. `null` marks a block that
        // opens no scope of its own, such as `if` or `repeat`.
        const open: Array<TessScope | null> = [];
        const scope = () => open.filter((entry) => entry !== null).pop() ?? this.root;
        let lineStart = true;
        let leader: string | undefined;

        for (let i = 0; i < this.tokens.length; i += 1) {
            const token = this.tokens[i];
            const previous = this.tokens[i - 1];
            if (previous && token.startLine > previous.endLine) lineStart = true;

            if (lineStart) {
                leader = token.image;
                lineStart = false;
                if (token.image === 'end') {
                    const closed = open.pop();
                    if (closed) closed.end = token.endOffset + 1;
                    leader = undefined;
                    continue;
                }
            }

            const kind = kinds[token.image];
            const name = this.tokens[i + 1];
            if (kind && name && /^[\p{L}_][\p{L}0-9_]*$/u.test(name.image)) {
                const range = this.tokenRange(name);
                const symbol: TessSymbol = { name: name.image, kind, nameRange: range, range };
                if (kind === 'function') this.functions.set(symbol.name, symbol);
                else scope().symbols.set(symbol.name, symbol);
            }

            if (token.image === ':' || token.image === 'then' || token.image === 'do') {
                open.push(this.fallbackScope(leader, token.endOffset + 1, scope()));
            }
        }
        // Whatever is still open runs to the end of the file, which is where the
        // cursor sits while the reader is typing it.
        for (const entry of open) if (entry) entry.end = this.root.end;
    }

    /** The scope a block opener introduces, or `null` when it introduces none. */
    private fallbackScope(leader: string | undefined, start: number, parent: TessScope): TessScope | null {
        const kind: ScopeKind | undefined = leader === 'object' || leader === 'text'
            ? 'object'
            : leader === 'when'
                ? 'event'
                : leader === 'function' ? 'function' : undefined;
        if (!kind) return null;
        const scope: TessScope = {
            kind,
            start,
            end: this.root.end,
            symbols: new Map(),
            parent,
            children: [],
            isText: kind === 'object' ? leader === 'text' : undefined,
            objectLocals: kind === 'object' ? new Map() : undefined,
        };
        parent.children.push(scope);
        return scope;
    }
}

/** True when the name needs no declaration to be legal. */
export function isKnownFreeName(name: string): boolean {
    return IMPLICIT_NAMES.has(name) || BUILTIN_FUNCTIONS.has(name);
}
