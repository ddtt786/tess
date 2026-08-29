// ============================================================================
//  Semantic highlighting
//
//  TextMate colours a word by its shape; this colours it by what it resolves
//  to, so a parameter, a global and a built in read differently even when they
//  are spelled with the same kind of letters.
// ============================================================================
import type { AstNode, CstNode, LeafCstNode } from 'langium';
import type { SemanticTokenAcceptor } from 'langium/lsp';
import { AbstractSemanticTokenProvider } from 'langium/lsp';
import { SemanticTokenModifiers, SemanticTokenTypes } from 'vscode-languageserver';
import {
    BUILTIN_FUNCTIONS, OBJECT_PROPERTIES, OPTION_KEYWORDS, STATE_VALUES, TEXT_ONLY_PROPERTIES,
} from './tess-core.js';
import { modelOf } from './tess-model.js';
import type { TessModel } from './tess-model.js';

/** AST types whose `name` or `id` is the declaring occurrence. */
const DECLARES: Record<string, { property: 'name' | 'id'; type: string }> = {
    VarDecl: { property: 'name', type: SemanticTokenTypes.variable },
    ListDecl: { property: 'name', type: SemanticTokenTypes.variable },
    FunctionDecl: { property: 'name', type: SemanticTokenTypes.function },
    ObjectDecl: { property: 'name', type: SemanticTokenTypes.class },
    Scene: { property: 'name', type: SemanticTokenTypes.namespace },
    Costume: { property: 'id', type: SemanticTokenTypes.enumMember },
    Sound: { property: 'id', type: SemanticTokenTypes.enumMember },
};

const isLeaf = (node: CstNode): node is LeafCstNode =>
    (node as LeafCstNode).tokenType !== undefined;

export class TessSemanticTokenProvider extends AbstractSemanticTokenProvider {
    protected highlightElement(node: AstNode, acceptor: SemanticTokenAcceptor): void {
        const cst = node.$cstNode;
        if (!cst) return;
        // A node that shares its parent's CST would emit the same tokens twice.
        if (safeAstNode(cst) !== node) return;

        const model = this.currentDocument ? modelOf(this.currentDocument) : undefined;
        const declares = DECLARES[node.$type];
        const declaredName = declares
            ? (node as unknown as Record<string, unknown>)[declares.property]
            : undefined;

        for (const child of (cst as { content?: CstNode[] }).content ?? []) {
            if (!isLeaf(child)) continue;
            const type = this.classify(node, child, model, declares, declaredName);
            if (type) acceptor({ cst: child, type: type.type, modifier: type.modifier });
        }
    }

    private classify(
        node: AstNode,
        leaf: LeafCstNode,
        model: TessModel | undefined,
        declares: { property: string; type: string } | undefined,
        declaredName: unknown,
    ): { type: string; modifier?: string[] } | undefined {
        const name = leaf.tokenType.name;
        const image = leaf.text;

        if (name === 'StringLiteral') {
            // An object or scene names itself with a string literal.
            if (declares && typeof declaredName === 'string' && unquote(image) === declaredName) {
                return { type: declares.type, modifier: [SemanticTokenModifiers.declaration] };
            }
            return { type: SemanticTokenTypes.string };
        }
        if (name === 'NumberLiteral') return { type: SemanticTokenTypes.number };
        if (name === 'ColorLiteral') return { type: SemanticTokenTypes.number };

        if (declares && image === declaredName) {
            return { type: declares.type, modifier: [SemanticTokenModifiers.declaration] };
        }

        if (node.$type === 'FunctionDecl' && isParameter(node, image)) {
            return {
                type: SemanticTokenTypes.parameter,
                modifier: [SemanticTokenModifiers.declaration],
            };
        }

        if (node.$type === 'Call' && (node as unknown as { callee?: string }).callee === image) {
            return BUILTIN_FUNCTIONS.has(image)
                ? { type: SemanticTokenTypes.function, modifier: [SemanticTokenModifiers.defaultLibrary] }
                : { type: SemanticTokenTypes.function };
        }

        if (node.$type === 'Identifier') return this.identifier(image, leaf, model);
        if (node.$type === 'Property' && image === (node as unknown as { name?: string }).name) {
            return { type: SemanticTokenTypes.property };
        }

        if (name.startsWith('kw_')) return { type: SemanticTokenTypes.keyword };
        if (name === 'Identifier') return this.identifier(image, leaf, model);
        return { type: SemanticTokenTypes.operator };
    }

    private identifier(
        image: string,
        leaf: LeafCstNode,
        model: TessModel | undefined,
    ): { type: string; modifier?: string[] } {
        const symbol = model?.symbols.resolve(image, leaf.offset);
        if (symbol) {
            switch (symbol.kind) {
                case 'param':
                    return { type: SemanticTokenTypes.parameter };
                case 'function':
                    return { type: SemanticTokenTypes.function };
                case 'costume':
                case 'sound':
                    return { type: SemanticTokenTypes.enumMember };
                default:
                    return { type: SemanticTokenTypes.variable };
            }
        }
        if (BUILTIN_FUNCTIONS.has(image)) {
            return { type: SemanticTokenTypes.function, modifier: [SemanticTokenModifiers.defaultLibrary] };
        }
        if (STATE_VALUES.has(image)) {
            return {
                type: SemanticTokenTypes.variable,
                modifier: [SemanticTokenModifiers.defaultLibrary, SemanticTokenModifiers.readonly],
            };
        }
        if (OBJECT_PROPERTIES.has(image) || TEXT_ONLY_PROPERTIES.has(image)) {
            return { type: SemanticTokenTypes.property };
        }
        if (OPTION_KEYWORDS.has(image)) return { type: SemanticTokenTypes.enumMember };
        return { type: SemanticTokenTypes.variable };
    }
}

const unquote = (image: string): string => image.slice(1, -1).replace(/\\(.)/g, '$1');

function isParameter(node: AstNode, image: string): boolean {
    const params = (node as unknown as { params?: string[] }).params ?? [];
    return params.includes(image) && (node as unknown as { name?: string }).name !== image;
}

/** `astNode` throws when a node was never attached; treat that as "not mine". */
function safeAstNode(cst: CstNode): AstNode | undefined {
    try {
        return cst.astNode;
    } catch {
        return undefined;
    }
}
