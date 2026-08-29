// ============================================================================
//  End to end
//
//  Spawns the packaged server and talks LSP to it exactly as VS Code would.
// ============================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { LspClient } from './lsp-client.js';
import { SAMPLE, extensionRoot, positionOf } from './helpers.js';

const server = path.join(extensionRoot, 'out', 'server.cjs');

let workspace;
let client;
let uri;

test.before(async () => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'tess-lsp-'));
    fs.writeFileSync(path.join(workspace, 'main.tess'), SAMPLE);
    fs.writeFileSync(path.join(workspace, 'parts.tess'), 'var 부품 = 1\n');
    uri = pathToFileURL(path.join(workspace, 'main.tess')).toString();

    client = new LspClient(server);
    const result = await client.initialize(pathToFileURL(workspace).toString());
    test.capabilities = result.capabilities;
    client.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: 'tess', version: 1, text: SAMPLE },
    });
});

test.after(async () => {
    await client?.stop();
    if (workspace) fs.rmSync(workspace, { recursive: true, force: true });
});

const diagnostics = async (target = uri) => {
    const note = await client.waitFor(
        (message) => message.method === 'textDocument/publishDiagnostics'
            && message.params.uri === target,
    );
    return note.params.diagnostics;
};

test('the server announces the capabilities the client needs', () => {
    const capabilities = test.capabilities;
    assert.ok(capabilities.completionProvider);
    assert.ok(capabilities.hoverProvider);
    assert.ok(capabilities.definitionProvider);
    assert.ok(capabilities.referencesProvider);
    assert.ok(capabilities.documentSymbolProvider);
    assert.ok(capabilities.renameProvider);
    assert.ok(capabilities.foldingRangeProvider);
    assert.ok(capabilities.semanticTokensProvider);
    assert.ok(capabilities.documentFormattingProvider);
    assert.ok(capabilities.documentHighlightProvider);
});

test('a clean document publishes no diagnostics', async () => {
    assert.deepEqual(await diagnostics(), []);
});

test('an edit republishes diagnostics', async () => {
    client.clear();
    client.notify('textDocument/didChange', {
        textDocument: { uri, version: 2 },
        contentChanges: [{ text: `${SAMPLE}\nobject "열린채":\n` }],
    });
    const published = await diagnostics();
    assert.equal(published.length, 1);
    assert.match(published[0].message, /end/);

    client.clear();
    client.notify('textDocument/didChange', {
        textDocument: { uri, version: 3 },
        contentChanges: [{ text: SAMPLE }],
    });
    assert.deepEqual(await diagnostics(), []);
});

test('hover, definition and symbols answer over the wire', async () => {
    const hover = await client.request('textDocument/hover', {
        textDocument: { uri }, position: positionOf(SAMPLE, 'key_down', 2),
    });
    assert.match(hover.contents.value, /key_down/);

    const definition = await client.request('textDocument/definition', {
        textDocument: { uri }, position: positionOf(SAMPLE, '체력 = 더하기', 6),
    });
    assert.equal(definition.length, 1);
    assert.equal(definition[0].targetUri, uri);

    const symbols = await client.request('textDocument/documentSymbol', { textDocument: { uri } });
    assert.deepEqual(symbols.map((entry) => entry.name), ['점수', '메인']);
});

test('completion answers over the wire', async () => {
    const list = await client.request('textDocument/completion', {
        textDocument: { uri }, position: positionOf(SAMPLE, 'say 점수'),
    });
    const labels = list.items.map((item) => item.label);
    assert.ok(labels.includes('forever'));
    assert.ok(labels.includes('체력'));
});

test('go to definition follows a `use` to the file it names', async () => {
    const source = 'use "parts.tess"\n';
    const other = pathToFileURL(path.join(workspace, 'entry.tess')).toString();
    client.notify('textDocument/didOpen', {
        textDocument: { uri: other, languageId: 'tess', version: 1, text: source },
    });
    await diagnostics(other);
    const links = await client.request('textDocument/definition', {
        textDocument: { uri: other }, position: { line: 0, character: 6 },
    });
    assert.equal(links.length, 1);
    assert.equal(links[0].targetUri, pathToFileURL(path.join(workspace, 'parts.tess')).toString());
});

test('formatting answers over the wire', async () => {
    const messy = pathToFileURL(path.join(workspace, 'messy.tess')).toString();
    const text = 'object "c":\nwhen start do\nsay 1\nend\nend\n';
    client.notify('textDocument/didOpen', {
        textDocument: { uri: messy, languageId: 'tess', version: 1, text },
    });
    await diagnostics(messy);
    const edits = await client.request('textDocument/formatting', {
        textDocument: { uri: messy },
        options: { tabSize: 2, insertSpaces: true },
    });
    assert.deepEqual(edits.map((edit) => edit.newText), ['  ', '    ', '  ']);
});

test('the server logs nothing alarming', () => {
    assert.doesNotMatch(client.stderr, /Error|Cannot|undefined is not/i, client.stderr);
});
