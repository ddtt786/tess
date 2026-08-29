// ============================================================================
//  Outline
//
//  Scenes, objects and their members, in the order they are written.
// ============================================================================
import type { LangiumDocument, MaybePromise } from 'langium';
import type { DocumentSymbol, DocumentSymbolParams } from 'vscode-languageserver';
import { SymbolKind } from 'vscode-languageserver';
import { modelOf } from './tess-model.js';
import type { TessSymbol } from './tess-symbols.js';

const KINDS: Record<TessSymbol['kind'], SymbolKind> = {
    variable: SymbolKind.Variable,
    list: SymbolKind.Array,
    function: SymbolKind.Function,
    param: SymbolKind.Variable,
    object: SymbolKind.Class,
    text: SymbolKind.String,
    scene: SymbolKind.Namespace,
    costume: SymbolKind.Field,
    sound: SymbolKind.Event,
    signal: SymbolKind.Event,
};

export class TessDocumentSymbolProvider {
    getSymbols(document: LangiumDocument, _params: DocumentSymbolParams): MaybePromise<DocumentSymbol[]> {
        const model = modelOf(document);
        if (!model) return [];
        return model.symbols.outline.map(toSymbol);
    }
}

function toSymbol(symbol: TessSymbol): DocumentSymbol {
    return {
        name: symbol.name,
        detail: symbol.detail,
        kind: KINDS[symbol.kind],
        range: symbol.range,
        selectionRange: clamp(symbol.nameRange, symbol.range),
        children: symbol.children?.map(toSymbol),
    };
}

/** The client rejects a selection range that escapes its parent. */
function clamp(inner: DocumentSymbol['range'], outer: DocumentSymbol['range']): DocumentSymbol['range'] {
    const before = inner.start.line < outer.start.line
        || (inner.start.line === outer.start.line && inner.start.character < outer.start.character);
    const after = inner.end.line > outer.end.line
        || (inner.end.line === outer.end.line && inner.end.character > outer.end.character);
    return before || after ? outer : inner;
}
