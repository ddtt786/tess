// ============================================================================
//  Diagnostics
//
//  The compiler's validator is the only source of truth: what the editor
//  underlines is exactly what `node index.js check` reports.
// ============================================================================
import type { AstNode, ValidationAcceptor, ValidationChecks } from 'langium';
import { AstUtils } from 'langium';
import type { Range } from 'vscode-languageserver';
import type { TessDiagnostic } from './tess-core.js';
import { getParseInfo } from './tess-bridge.js';
import type { TessModel } from './tess-model.js';
import { modelOf } from './tess-model.js';

export class TessValidator {
    /** Replays the compiler's findings onto the document. */
    checkProgram(program: AstNode, accept: ValidationAcceptor): void {
        const info = getParseInfo(program);
        if (!info?.parsed) return;
        const model = modelOf(AstUtils.getDocument(program));
        if (!model) return;

        for (const error of info.errors) {
            accept('error', error.message, { node: program, range: rangeOf(model, error) });
        }
        for (const warning of info.warnings) {
            accept('warning', warning.message, { node: program, range: rangeOf(model, warning) });
        }
    }
}

/** Points the squiggle at the token the compiler blamed. */
function rangeOf(model: TessModel, diagnostic: TessDiagnostic): Range {
    const token = model.tokenAt(diagnostic.offset);
    if (token && token.startOffset === diagnostic.offset) return model.symbols.tokenRange(token);
    const start = { line: diagnostic.line - 1, character: diagnostic.column - 1 };
    return { start, end: { line: start.line, character: start.character + 1 } };
}

/** The check table the module hands to Langium's validation registry. */
export function tessValidationChecks(validator: TessValidator): ValidationChecks<object> {
    return {
        Program: (node: AstNode, accept: ValidationAcceptor) => validator.checkProgram(node, accept),
    } as unknown as ValidationChecks<object>;
}
