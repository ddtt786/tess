// ============================================================================
//  Language services
//
//  Drives the same service container the editor uses, without a client.
// ============================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SAMPLE, api, positionOf, repoRoot } from './helpers.js';

const uri = 'file:///tess/main.tess';
let sample;

test.before(async () => {
    sample = await api.analyzeText(SAMPLE, uri);
});

test('valid source produces no diagnostics', () => {
    assert.deepEqual(sample.diagnostics, []);
});

test('the compiler decides what is an error', async () => {
    const bad = await api.analyzeText('object "x":\n  var a = 1\n', 'file:///tess/a.tess');
    assert.equal(bad.diagnostics.length, 1);
    assert.equal(bad.diagnostics[0].severity, 1);
    assert.match(bad.diagnostics[0].message, /end/);
    assert.equal(bad.diagnostics[0].range.start.line, 2);
});

test('semantic rules are reported as the compiler reports them', async () => {
    const source = 'object "고양이":\n  when start do\n    write "x"\n  end\nend\n';
    const result = await api.analyzeText(source, 'file:///tess/b.tess');
    assert.equal(result.diagnostics.length, 1);
    assert.match(result.diagnostics[0].message, /글상자\(text\) 전용/);
    assert.deepEqual(result.diagnostics[0].range.start, { line: 2, character: 4 });
});

test('an unknown name is a warning on the name itself', async () => {
    const source = 'object "c":\n  when start do\n    say 없는이름\n  end\nend\n';
    const result = await api.analyzeText(source, 'file:///tess/c.tess');
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0].severity, 2);
    assert.deepEqual(result.diagnostics[0].range, {
        start: { line: 2, character: 8 },
        end: { line: 2, character: 12 },
    });
});

test('a file that does not parse still yields a document', async () => {
    const result = await api.analyzeText('var a = (1 +\n', 'file:///tess/d.tess');
    assert.equal(result.document.parseResult.value.$type, 'Program');
    assert.equal(result.diagnostics.length, 1);
    assert.ok(result.model, 'the model survives a parse failure');
});

test('every lexed token lands in the CST exactly once', () => {
    const info = api.getParseInfo(sample.document.parseResult.value);
    const offsets = new Set();
    let leaves = 0;
    const walk = (node) => {
        if (node.content) node.content.forEach(walk);
        else {
            leaves += 1;
            offsets.add(node.offset);
        }
    };
    walk(sample.document.parseResult.value.$cstNode.root);
    assert.equal(leaves, info.tokens.length);
    for (const token of info.tokens) {
        assert.ok(offsets.has(token.startOffset), `missing token at ${token.startOffset}`);
    }
});

test('the outline nests objects under their scene', async () => {
    const symbols = await sample.services.lsp.DocumentSymbolProvider
        .getSymbols(sample.document, { textDocument: { uri } });
    assert.deepEqual(symbols.map((entry) => entry.name), ['점수', '메인']);
    const scene = symbols[1];
    assert.deepEqual(scene.children.map((entry) => entry.name), ['고양이']);
    const object = scene.children[0];
    assert.deepEqual(object.children.map((entry) => entry.name), ['기본', '야옹', '체력', '더하기']);
    // The selection range names the declaration, not the whole block.
    assert.deepEqual(object.selectionRange.start, positionOf(SAMPLE, '"고양이"'));
});

test('go to definition resolves a call to its function', async () => {
    const position = positionOf(SAMPLE, '체력 = 더하기', 6);
    const links = await sample.services.lsp.DefinitionProvider
        .getDefinition(sample.document, { textDocument: { uri }, position });
    assert.equal(links.length, 1);
    assert.deepEqual(links[0].targetSelectionRange.start, positionOf(SAMPLE, 'function 더하기', 9));
});

test('references cover the declaration and every use', async () => {
    const position = positionOf(SAMPLE, 'var 체력', 4);
    const locations = await sample.services.lsp.ReferencesProvider.findReferences(sample.document, {
        textDocument: { uri }, position, context: { includeDeclaration: true },
    });
    assert.equal(locations.length, 3);
    assert.deepEqual(locations.map((entry) => entry.range.start.line), [10, 18, 18]);
});

test('a function does not see the object locals it may not use', async () => {
    const source = [
        'object "c":',
        '  var 지역 = 1',
        '  function f():',
        '    return 지역',
        '  end',
        'end',
        '',
    ].join('\n');
    const result = await api.analyzeText(source, 'file:///tess/e.tess');
    // spec 14.2 — the compiler rejects this, and so must the editor.
    assert.equal(result.diagnostics.length, 1);
    assert.match(result.diagnostics[0].message, /함수 안에서는/);
    const symbol = result.model.symbols.resolve('지역', source.indexOf('return 지역') + 7);
    assert.equal(symbol, undefined);
});

test('rename rewrites every occurrence and nothing else', async () => {
    const position = positionOf(SAMPLE, 'var 체력', 4);
    const edit = await sample.services.lsp.RenameProvider.rename(sample.document, {
        textDocument: { uri }, position, newName: 'hp',
    });
    const edits = edit.changes[uri];
    assert.equal(edits.length, 3);
    assert.ok(edits.every((entry) => entry.newText === 'hp'));
    const rejected = await sample.services.lsp.RenameProvider.rename(sample.document, {
        textDocument: { uri }, position, newName: '2bad',
    });
    assert.equal(rejected, undefined);
});

test('hover documents a built in and a declaration', async () => {
    const builtin = await sample.services.lsp.HoverProvider.getHoverContent(sample.document, {
        textDocument: { uri }, position: positionOf(SAMPLE, 'key_down', 2),
    });
    assert.match(builtin.contents.value, /key_down\("키"\)/);

    const declared = await sample.services.lsp.HoverProvider.getHoverContent(sample.document, {
        textDocument: { uri }, position: positionOf(SAMPLE, 'say 점수', 5),
    });
    assert.match(declared.contents.value, /변수/);
});

test('completion offers statements at the start of a line', async () => {
    const position = positionOf(SAMPLE, 'say 점수');
    const list = await sample.services.lsp.CompletionProvider
        .getCompletion(sample.document, { textDocument: { uri }, position });
    const labels = list.items.map((item) => item.label);
    assert.ok(labels.includes('forever'), 'a statement keyword');
    assert.ok(labels.includes('체력'), 'a name in scope');
    assert.ok(labels.includes('x'), 'a writable property');
});

test('completion offers event forms after `when`', async () => {
    const source = 'object "c":\n  when \nend\n';
    const result = await api.analyzeText(source, 'file:///tess/f.tess');
    const list = await result.services.lsp.CompletionProvider.getCompletion(result.document, {
        textDocument: { uri: 'file:///tess/f.tess' }, position: { line: 1, character: 7 },
    });
    const labels = list.items.map((item) => item.label);
    assert.ok(labels.includes('when key'));
    assert.ok(labels.includes('when cloned'));
});

test('completion still works while the file does not parse', async () => {
    const source = 'var 점수 = 0\nobject "c":\n  when start do\n    say \n';
    const result = await api.analyzeText(source, 'file:///tess/g.tess');
    assert.ok(result.diagnostics.length > 0, 'the file is indeed broken');
    const list = await result.services.lsp.CompletionProvider.getCompletion(result.document, {
        textDocument: { uri: 'file:///tess/g.tess' }, position: { line: 3, character: 8 },
    });
    const labels = list.items.map((item) => item.label);
    assert.ok(labels.includes('점수'), 'declarations are read off the token stream');
    assert.ok(labels.includes('key_down'), 'built ins are always available');
});

test('an unparsed file still knows which block the cursor is in', async () => {
    const uri = 'file:///tess/i.tess';
    const source = 'var 점수 = 0\nobject "c":\n  var 체력 = 1\n  when start do\n    \n';
    const result = await api.analyzeText(source, uri);
    assert.ok(result.diagnostics.length > 0, 'the file is indeed broken');

    const offset = source.length - 1;
    assert.equal(result.model.symbols.scopeAt(offset).kind, 'event');
    assert.deepEqual(
        result.model.symbols.visibleSymbols(offset).map((entry) => entry.name).sort(),
        ['점수', '체력'],
    );

    const inScript = await result.services.lsp.CompletionProvider.getCompletion(result.document, {
        textDocument: { uri }, position: { line: 4, character: 4 },
    });
    const labels = inScript.items.map((item) => item.label);
    assert.ok(labels.includes('forever'), 'statement keywords inside a script');
    assert.ok(!labels.includes('project'), 'and no top level declarations');

    const memberUri = 'file:///tess/j.tess';
    const member = await api.analyzeText('object "c":\n  \n', memberUri);
    const inObject = await member.services.lsp.CompletionProvider.getCompletion(member.document, {
        textDocument: { uri: memberUri }, position: { line: 1, character: 2 },
    });
    const memberLabels = inObject.items.map((item) => item.label);
    assert.ok(memberLabels.includes('costume'), 'member keywords inside an object');
    assert.ok(memberLabels.includes('when start'));
});

test('semantic tokens separate parameters, built ins and variables', async () => {
    const result = await sample.services.lsp.SemanticTokenProvider
        .semanticHighlight(sample.document, { textDocument: { uri } });
    assert.ok(result.data.length > 0);
    assert.equal(result.data.length % 5, 0);
    const types = sample.services.lsp.SemanticTokenProvider.tokenTypes;
    const used = new Set();
    for (let i = 4; i < result.data.length; i += 5) used.add(result.data[i - 1]);
    assert.ok(used.has(types.parameter), 'parameters are highlighted as such');
    assert.ok(used.has(types.keyword));
    assert.ok(used.has(types.variable));
});

test('folding covers every block that closes with end', async () => {
    const ranges = await sample.services.lsp.FoldingRangeProvider
        .getFoldingRanges(sample.document, { textDocument: { uri } });
    const starts = ranges.map((range) => range.startLine);
    assert.ok(starts.includes(0), 'project');
    assert.ok(starts.includes(6), 'scene');
    assert.ok(starts.includes(7), 'object');
    assert.ok(starts.includes(12), 'function');
});

test('formatting re-indents by block depth and leaves the rest alone', async () => {
    const messy = 'object "c":\nwhen start do\nsay 1\nif true:\nsay 2\nend\nend\nend\n';
    const result = await api.analyzeText(messy, 'file:///tess/h.tess');
    const edits = await result.services.lsp.Formatter.formatDocument(result.document, {
        textDocument: { uri: 'file:///tess/h.tess' },
        options: { tabSize: 2, insertSpaces: true },
    });
    assert.equal(apply(messy, edits), [
        'object "c":',
        '  when start do',
        '    say 1',
        '    if true:',
        '      say 2',
        '    end',
        '  end',
        'end',
        '',
    ].join('\n'));
});

test('formatting agrees with the indentation the examples are written in', async () => {
    for (const file of tessFiles(path.join(repoRoot, 'examples'))) {
        const text = fs.readFileSync(file, 'utf8');
        const uri = `file://${file}`;
        const options = { tabSize: 2, insertSpaces: true };
        const result = await api.analyzeText(text, uri);
        const edits = await result.services.lsp.Formatter
            .formatDocument(result.document, { textDocument: { uri }, options });
        const formatted = apply(text, edits);
        const name = path.basename(file);

        // Only leading whitespace may move.
        assert.deepEqual(
            formatted.split('\n').map((line) => line.trimStart()),
            text.split('\n').map((line) => line.trimStart()),
            `${name}: formatting rewrote a line`,
        );
        // Lines with content already sit where the formatter would put them.
        for (const [line, before] of text.split('\n').entries()) {
            if (before.trim() === '') continue;
            assert.equal(formatted.split('\n')[line], before, `${name}:${line + 1}`);
        }
        // And running it again changes nothing.
        const secondUri = `${uri}`.replace(/\.tess$/, '.formatted.tess');
        const again = await api.analyzeText(formatted, secondUri);
        const second = await again.services.lsp.Formatter
            .formatDocument(again.document, { textDocument: { uri: secondUri }, options });
        assert.deepEqual(second, [], `${name}: formatting is not idempotent`);
    }
});

test('the repository examples analyse cleanly and quickly', async () => {
    for (const file of tessFiles(path.join(repoRoot, 'examples'))) {
        const text = fs.readFileSync(file, 'utf8');
        const result = await api.analyzeText(text, `file://${file}`);
        assert.deepEqual(
            result.diagnostics.map((entry) => entry.message),
            [],
            path.basename(file),
        );
    }
});

function tessFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...tessFiles(full));
        else if (entry.name.endsWith('.tess')) out.push(full);
    }
    return out.sort();
}

/** Applies text edits bottom up, the way a client would. */
function apply(text, edits) {
    const lines = text.split('\n');
    for (const edit of [...edits].sort((a, b) => b.range.start.line - a.range.start.line)) {
        assert.equal(edit.range.start.line, edit.range.end.line, 'edits stay on one line');
        const line = lines[edit.range.start.line];
        lines[edit.range.start.line] = line.slice(0, edit.range.start.character)
            + edit.newText
            + line.slice(edit.range.end.character);
    }
    return lines.join('\n');
}
