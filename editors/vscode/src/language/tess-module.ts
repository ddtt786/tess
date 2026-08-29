// ============================================================================
//  Dependency injection module
//
//  Langium supplies the document lifecycle, the LSP plumbing and the service
//  container. Parsing is delegated to the compiler's grammar, and every service
//  that would otherwise be driven by a generated grammar is replaced with one
//  that reads the Tess semantic model directly.
// ============================================================================
import type { LangiumCoreServices, LangiumParser, Module } from 'langium';
import { inject } from 'langium';
import type {
    DefaultSharedModuleContext, LangiumServices, LangiumSharedServices, PartialLangiumServices,
} from 'langium/lsp';
import { createDefaultModule, createDefaultSharedModule } from 'langium/lsp';
import { TessGeneratedModule, TessGeneratedSharedModule } from './generated/module.js';
import { TessBridgeParser } from './tess-bridge.js';
import { TessCompletionProvider } from './tess-completion.js';
import { TessDocumentSymbolProvider } from './tess-document-symbol.js';
import { TessFoldingRangeProvider } from './tess-folding.js';
import { TessFormatter } from './tess-formatter.js';
import { TessHoverProvider } from './tess-hover.js';
import {
    TessDefinitionProvider, TessDocumentHighlightProvider, TessReferencesProvider, TessRenameProvider,
} from './tess-navigation.js';
import { TessSemanticTokenProvider } from './tess-semantic-tokens.js';
import { TessValidator, tessValidationChecks } from './tess-validator.js';

/** Services this language adds on top of Langium's defaults. */
export type TessAddedServices = {
    validation: {
        TessValidator: TessValidator;
    };
};

export type TessServices = LangiumServices & TessAddedServices;

export const TessModule: Module<TessServices, PartialLangiumServices & TessAddedServices> = {
    parser: {
        // The bridge only implements `parse`, which is all Langium asks of this service.
        LangiumParser: () => new TessBridgeParser() as unknown as LangiumParser,
    },
    validation: {
        TessValidator: () => new TessValidator(),
    },
    lsp: {
        CompletionProvider: () => new TessCompletionProvider(),
        HoverProvider: () => new TessHoverProvider(),
        DefinitionProvider: () => new TessDefinitionProvider(),
        ReferencesProvider: () => new TessReferencesProvider(),
        DocumentHighlightProvider: () => new TessDocumentHighlightProvider(),
        RenameProvider: () => new TessRenameProvider(),
        DocumentSymbolProvider: () => new TessDocumentSymbolProvider(),
        FoldingRangeProvider: () => new TessFoldingRangeProvider(),
        SemanticTokenProvider: (services) => new TessSemanticTokenProvider(services),
        Formatter: () => new TessFormatter(),
    },
};

export function createTessServices(context: DefaultSharedModuleContext): {
    shared: LangiumSharedServices;
    Tess: TessServices;
} {
    const shared = inject(createDefaultSharedModule(context), TessGeneratedSharedModule);
    const Tess = inject(createDefaultModule({ shared }), TessGeneratedModule, TessModule);
    shared.ServiceRegistry.register(Tess);
    registerValidationChecks(Tess);
    if (!context.connection) {
        // Running headless (tests, scripts): nothing initialises the workspace.
        shared.workspace.ConfigurationProvider.initialized({});
    }
    return { shared, Tess };
}

function registerValidationChecks(services: TessServices): void {
    const registry = (services as unknown as LangiumCoreServices).validation.ValidationRegistry;
    registry.register(tessValidationChecks(services.validation.TessValidator));
}
