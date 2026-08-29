// ============================================================================
//  Tess AST -> Langium document
//
//  Runs the compiler's own lexer and parser, then mirrors the result onto the
//  semantic model declared in `tess.langium`. Every AST node gets a composite
//  CST node holding the tokens it spans, so Langium's position lookups, ranges
//  and document segments all work against real source offsets.
// ============================================================================
import type { AstNode, CstNode, Mutable, ParseResult, RootCstNode } from 'langium';
import { CompositeCstNodeImpl, CstUtils, LeafCstNodeImpl, RootCstNodeImpl } from 'langium';
import type { IRecognitionException, TokenType } from 'chevrotain';
import type { TessDiagnostic, TessNode, TessToken } from './tess-core.js';
import { parse, tokenize } from './tess-core.js';

/** Everything the services need beyond the AST itself, kept off the nodes. */
export interface TessParseInfo {
    text: string;
    tokens: TessToken[];
    /** Semantic errors from the compiler's validator. Parse failures are reported separately. */
    errors: TessDiagnostic[];
    warnings: TessDiagnostic[];
    /** False when the file did not parse, so the AST is an empty stand-in. */
    parsed: boolean;
}

const parseInfos = new WeakMap<AstNode, TessParseInfo>();

/** The parse context for a document root, if it came from this parser. */
export function getParseInfo(node: AstNode | undefined): TessParseInfo | undefined {
    return node ? parseInfos.get(node) : undefined;
}

// AST type names that would shadow a JavaScript global once generated.
const TYPE_NAMES: Record<string, string> = {
    Object: 'ObjectDecl',
    String: 'StringLiteral',
    Number: 'NumberLiteral',
    Boolean: 'BooleanLiteral',
    Keyword: 'KeywordValue',
};

/** `jump next` and `jump back` name a scene directly rather than by expression. */
const PROPERTY_NAMES: Record<string, Record<string, string>> = {
    Jump: { target: 'where' },
};

const isTessNode = (value: unknown): value is TessNode =>
    typeof value === 'object' && value !== null && typeof (value as TessNode).type === 'string';

interface Child {
    node: TessNode;
    property: string;
    index?: number;
}

class CstWriter {
    private cursor = 0;

    constructor(readonly root: RootCstNode, private readonly tokens: TessToken[]) { }

    /** Moves every token that starts before `offset` into `target`. */
    fill(target: CompositeCstNodeImpl, offset: number): void {
        while (this.cursor < this.tokens.length && this.tokens[this.cursor].startOffset < offset) {
            const token = this.tokens[this.cursor];
            this.cursor += 1;
            const leaf = new LeafCstNodeImpl(
                token.startOffset,
                token.image.length,
                CstUtils.tokenToRange(token as never),
                token.tokenType as unknown as TokenType,
                false,
            );
            (leaf as Mutable<CstNode>).root = this.root;
            target.content.push(leaf);
        }
    }
}

/** Builds the Langium node for one Tess node, and the CST beneath it. */
function convert(
    source: TessNode,
    container: AstNode | undefined,
    property: string | undefined,
    index: number | undefined,
    parentCst: CompositeCstNodeImpl,
    writer: CstWriter,
): AstNode {
    const node = {
        $type: TYPE_NAMES[source.type] ?? source.type,
        $container: container,
        $containerProperty: property,
        $containerIndex: index,
    } as Mutable<AstNode> & Record<string, unknown>;

    const renames = PROPERTY_NAMES[source.type];
    const children: Child[] = [];

    for (const [key, value] of Object.entries(source)) {
        if (key === 'type' || key === 'loc') continue;
        const name = renames?.[key] ?? key;
        if (isTessNode(value)) {
            children.push({ node: value, property: name });
        } else if (Array.isArray(value) && value.some(isTessNode)) {
            node[name] = [];
            value.forEach((item, at) => {
                if (isTessNode(item)) children.push({ node: item, property: name, index: at });
            });
        } else if (value !== null && value !== undefined) {
            node[name] = value;
        }
    }

    // A node without a span of its own — only `rotation free` produces one —
    // shares its parent's CST node rather than claiming any tokens.
    if (!source.loc) {
        node.$cstNode = parentCst;
        attachChildren(node, children, parentCst, writer, Number.POSITIVE_INFINITY, true);
        return node;
    }

    const cst = new CompositeCstNodeImpl();
    (cst as Mutable<CstNode>).root = writer.root;
    parentCst.content.push(cst);
    node.$cstNode = cst;
    cst.astNode = node;

    attachChildren(node, children, cst, writer, source.loc.end, false);
    return node;
}

function attachChildren(
    node: Record<string, unknown>,
    children: Child[],
    cst: CompositeCstNodeImpl,
    writer: CstWriter,
    end: number,
    shared: boolean,
): void {
    children.sort((a, b) => (a.node.loc?.start ?? end) - (b.node.loc?.start ?? end));

    for (const child of children) {
        if (child.node.loc) writer.fill(cst, child.node.loc.start);
        const built = convert(child.node, node as unknown as AstNode, child.property, child.index, cst, writer);
        if (child.index === undefined) node[child.property] = built;
        else (node[child.property] as AstNode[])[child.index] = built;
    }

    if (!shared) writer.fill(cst, end);
}

/** An empty program, so the document always has a root to hang services off. */
function emptyProgram(text: string): { value: AstNode; rootCst: RootCstNode } {
    const rootCst = new RootCstNodeImpl(text);
    (rootCst as Mutable<CstNode>).root = rootCst;
    const node = {
        $type: 'Program', body: [], $cstNode: rootCst,
    } as unknown as Mutable<AstNode>;
    rootCst.astNode = node;
    return { value: node, rootCst };
}

/** Turns a compiler diagnostic into the chevrotain-shaped error Langium reports. */
function toParserError(diagnostic: TessDiagnostic, tokens: TessToken[], text: string): IRecognitionException {
    const at = tokens.find((token) => token.startOffset >= diagnostic.offset);
    const token = at ?? {
        image: text.slice(diagnostic.offset, diagnostic.offset + 1) || ' ',
        startOffset: diagnostic.offset,
        endOffset: diagnostic.offset,
        startLine: diagnostic.line,
        startColumn: diagnostic.column,
        endLine: diagnostic.line,
        endColumn: diagnostic.column,
    };
    return {
        name: 'TessParseError',
        message: diagnostic.message,
        token,
        resyncedTokens: [],
        context: { ruleStack: [], ruleOccurrenceStack: [] },
    } as unknown as IRecognitionException;
}

/**
 * Stands in for Langium's generated parser. Only `parse` is ever called on this
 * service, so the bridge implements that and nothing else.
 */
export class TessBridgeParser {
    parse<T extends AstNode = AstNode>(input: string): ParseResult<T> {
        const lexed = tokenize(input);
        const result = parse(input);

        if (!result.ast) {
            const { value } = emptyProgram(input);
            parseInfos.set(value, {
                text: input, tokens: lexed.tokens, errors: [], warnings: [], parsed: false,
            });
            // `parse` already localises both lexer and parser failures.
            return {
                value: value as T,
                parserErrors: result.errors.map((error) => toParserError(error, lexed.tokens, input)),
                lexerErrors: [],
                lexerReport: { diagnostics: [] },
            } as ParseResult<T>;
        }

        const rootCst = new RootCstNodeImpl(input);
        (rootCst as Mutable<CstNode>).root = rootCst;
        const writer = new CstWriter(rootCst, lexed.tokens);
        const value = convert(result.ast, undefined, undefined, undefined, rootCst, writer);
        rootCst.astNode = value;

        parseInfos.set(value, {
            text: input,
            tokens: lexed.tokens,
            errors: result.errors,
            warnings: result.warnings,
            parsed: true,
        });

        return {
            value: value as T,
            parserErrors: [],
            lexerErrors: [],
            lexerReport: { diagnostics: [] },
        } as ParseResult<T>;
    }
}
