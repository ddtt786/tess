// ============================================================================
//  Definition, references, highlight and rename
//
//  Name resolution follows the same scope rules the validator applies, so a
//  jump never lands on a declaration the compiler would not have used.
// ============================================================================
import type { LangiumDocument, MaybePromise } from 'langium';
import { URI } from 'langium';
import type {
    DefinitionParams, DocumentHighlight, DocumentHighlightParams, Location, LocationLink,
    Range, ReferenceParams, RenameParams, TextEdit, WorkspaceEdit,
} from 'vscode-languageserver';
import { DocumentHighlightKind } from 'vscode-languageserver';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { Target, TessModel } from './tess-model.js';
import { modelOf } from './tess-model.js';

export class TessDefinitionProvider {
    getDefinition(document: LangiumDocument, params: DefinitionParams): MaybePromise<LocationLink[] | undefined> {
        const model = modelOf(document);
        if (!model) return undefined;
        const target = model.targetAt(model.offsetAt(params.position));
        if (!target) return undefined;

        if (target.symbol) {
            return [{
                targetUri: document.uri.toString(),
                targetRange: target.symbol.range,
                targetSelectionRange: target.symbol.nameRange,
                originSelectionRange: target.range,
            }];
        }

        // `use "…"` and `useobject "…"` point at another file.
        const used = this.usedFile(document, model, target);
        if (used) {
            const zero: Range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
            return [{
                targetUri: used,
                targetRange: zero,
                targetSelectionRange: zero,
                originSelectionRange: target.range,
            }];
        }
        return undefined;
    }

    /** Resolves the path of a `use` declaration relative to the current file. */
    private usedFile(document: LangiumDocument, model: TessModel, target: Target): string | undefined {
        if (target.kind !== 'string') return undefined;
        const entry = model.symbols.uses.find((use) => sameRange(use.range, target.range));
        if (!entry) return undefined;
        const base = document.uri.fsPath;
        if (!base) return undefined;
        const resolved = path.resolve(path.dirname(base), entry.path);
        if (!fs.existsSync(resolved)) return undefined;
        return URI.file(resolved).toString();
    }
}

export class TessReferencesProvider {
    findReferences(document: LangiumDocument, params: ReferenceParams): MaybePromise<Location[]> {
        const model = modelOf(document);
        if (!model) return [];
        const target = model.targetAt(model.offsetAt(params.position));
        if (!target?.symbol) return [];
        const uri = document.uri.toString();
        const ranges = model.occurrences(target.symbol);
        const wanted = params.context.includeDeclaration
            ? ranges
            : ranges.filter((range) => !sameRange(range, target.symbol!.nameRange));
        return wanted.map((range) => ({ uri, range }));
    }
}

export class TessDocumentHighlightProvider {
    getDocumentHighlight(
        document: LangiumDocument,
        params: DocumentHighlightParams,
    ): MaybePromise<DocumentHighlight[] | undefined> {
        const model = modelOf(document);
        if (!model) return undefined;
        const target = model.targetAt(model.offsetAt(params.position));
        if (!target?.symbol) return undefined;
        const declaration = target.symbol.nameRange;
        return model.occurrences(target.symbol).map((range) => ({
            range,
            kind: sameRange(range, declaration) ? DocumentHighlightKind.Write : DocumentHighlightKind.Read,
        }));
    }
}

export class TessRenameProvider {
    rename(document: LangiumDocument, params: RenameParams): MaybePromise<WorkspaceEdit | undefined> {
        const model = modelOf(document);
        if (!model) return undefined;
        const target = model.targetAt(model.offsetAt(params.position));
        if (!target?.symbol) return undefined;
        if (!/^[\p{L}_][\p{L}0-9_]*$/u.test(params.newName)) return undefined;

        const edits: TextEdit[] = model.occurrences(target.symbol)
            .map((range) => ({ range, newText: params.newName }));
        if (edits.length === 0) return undefined;
        return { changes: { [document.uri.toString()]: edits } };
    }

    prepareRename(document: LangiumDocument, params: { position: { line: number; character: number } }): MaybePromise<Range | undefined> {
        const model = modelOf(document);
        if (!model) return undefined;
        const target = model.targetAt(model.offsetAt(params.position));
        return target?.symbol ? target.range : undefined;
    }
}

const sameRange = (a: Range, b: Range): boolean =>
    a.start.line === b.start.line && a.start.character === b.start.character
    && a.end.line === b.end.line && a.end.character === b.end.character;
