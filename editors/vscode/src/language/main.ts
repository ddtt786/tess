// ============================================================================
//  Language server entry point
//
//  Speaks LSP over stdio; the VS Code client starts this in a Node process.
// ============================================================================
import { startLanguageServer } from 'langium/lsp';
import { NodeFileSystem } from 'langium/node';
import { ProposedFeatures, createConnection } from 'vscode-languageserver/node';
import { createTessServices } from './tess-module.js';

const connection = createConnection(ProposedFeatures.all);
const { shared } = createTessServices({ connection, ...NodeFileSystem });
startLanguageServer(shared);
