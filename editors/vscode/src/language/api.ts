// ============================================================================
//  Headless API
//
//  Exposes the same analysis the editor runs, for tests and for tools that want
//  editor-accurate results without an editor.
// ============================================================================
import type { LangiumDocument } from 'langium';
import { EmptyFileSystem, URI } from 'langium';
import type { Diagnostic } from 'vscode-languageserver';
import type { TessServices } from './tess-module.js';
import { createTessServices } from './tess-module.js';
import type { TessModel } from './tess-model.js';
import { modelOf } from './tess-model.js';

export { createTessServices, TessModule } from './tess-module.js';
export { modelOf, TessModel } from './tess-model.js';
export { getParseInfo } from './tess-bridge.js';
export { TessSymbolTable } from './tess-symbols.js';
export type { TessSymbol } from './tess-symbols.js';

export interface TessAnalysis {
    document: LangiumDocument;
    model: TessModel | undefined;
    diagnostics: Diagnostic[];
    services: TessServices;
}

let cached: { shared: ReturnType<typeof createTessServices>['shared']; Tess: TessServices } | undefined;

/** Services backed by an empty file system, for one-off analysis. */
export function headlessServices(): { shared: ReturnType<typeof createTessServices>['shared']; Tess: TessServices } {
    cached ??= createTessServices(EmptyFileSystem);
    return cached;
}

/** Parses and validates one source text the way the editor would. */
export async function analyzeText(text: string, uri = 'file:///tess/main.tess'): Promise<TessAnalysis> {
    const { shared, Tess } = headlessServices();
    const documents = shared.workspace.LangiumDocuments;
    const target = URI.parse(uri);
    if (documents.hasDocument(target)) await documents.deleteDocument(target);
    const document = shared.workspace.LangiumDocumentFactory.fromString(text, target);
    documents.addDocument(document);
    await shared.workspace.DocumentBuilder.build([document], { validation: true });
    return {
        document,
        model: modelOf(document),
        diagnostics: document.diagnostics ?? [],
        services: Tess,
    };
}
