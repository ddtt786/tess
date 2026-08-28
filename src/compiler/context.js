// Compile context.
//
// Central home for block creation, the symbol table (objects, scenes,
// variables, messages, functions), and diagnostics collection.
import { createIdFactory, seedFrom } from './ids.js';
import { commentKey, makeComment } from './comments.js';
import { lineAndColumn } from '../validate.js';

/** Base skeleton of one Entry block. */
export function makeBlock(id, type, params = [], statements = []) {
  return {
    id,
    x: 0,
    y: 0,
    type,
    params,
    statements,
    movable: null,
    deletable: 1,
    emphasized: false,
    readOnly: null,
    copyable: true,
    assemble: true,
    extensions: [],
  };
}

export class Context {
  constructor(source, options = {}) {
    this.source = source;
    this.sources = options.sources ?? null;
    this.options = options;
    this.assetFiles = [];
    this.comments = options.comments ?? new Map();
    this.newId = createIdFactory(seedFrom(options.seed ?? source));
    this.errors = [];
    this.warnings = [];

    // block id -> the Tess source location that created it. When Entry
    // panics at runtime it reports only the block id, not the source line,
    // so the debug panel looks up this table to map block -> source location.
    this.sourceMap = {};
    this.currentNode = null; // AST node of the statement currently compiling (for block location tagging)
    this.usesTts = false; // any read/tts statement adds 'tts' to project.aiUtilizeBlocks
    // Real Entry ids pinned via `force id "..."` on costume/sound declarations
    // (SPEC-ADDENDUM.md 1.4). resolvePicture/resolveSound check this set to
    // tell "a string that isn't this object's own resource name, but is a
    // pinned real id elsewhere" — kept separate from ctx.newId's output
    // (which spans scene/object/variable/block ids too) so a typo in a
    // costume name can't collide with an unrelated generated id and silently
    // resolve to the wrong thing.
    this.forcedResourceIds = new Set();

    // symbol table
    this.scenes = [];           // { id, name }
    this.sceneByName = new Map();
    this.objects = [];          // { id, name, kind, ... }
    this.objectByName = new Map();
    this.variables = [];        // Entry variables entries
    this.globals = new Map();   // name -> variable entry
    this.messages = [];
    this.messageByName = new Map();
    this.functions = [];        // { id, name, node, params, isValue, owner }
    this.functionByName = new Map();
    this.runtimeFunctions = new Map(); // compiler-synthesized functions (scale_x/scale_y)

    // current compile position
    this.object = null;         // current object
    this.locals = new Map();    // object-local variable name -> variable entry
    this.funcScope = null;      // inside a function: { name, params:Set, localVars:Map }
  }

  // --- diagnostics ---------------------------------------------------------
  error(node, message) {
    this.#report(this.errors, node, message);
    return null;
  }

  warn(node, message) {
    this.#report(this.warnings, node, message);
    return null;
  }

  #report(bucket, node, message) {
    const offset = node?.loc?.start ?? 0;
    const file = node?.loc?.file;
    const text = (file && this.sources?.get(file)) ?? this.source;
    const { line, column } = lineAndColumn(text, offset);
    bucket.push({ line, column, file, offset, message });
  }

  // --- block creation --------------------------------------------------------
  block(type, params = [], statements = []) {
    const block = makeBlock(this.newId(), type, params, statements);
    this.#recordLocation(block);
    return block;
  }

  /** Records where the just-created block came from in the source, into sourceMap. */
  #recordLocation(block) {
    const node = this.currentNode;
    if (!node?.loc) return;
    const file = node.loc.file ?? this.options.path ?? null;
    const text = (file && this.sources?.get(file)) ?? this.source;
    const start = lineAndColumn(text, node.loc.start);
    const end = lineAndColumn(text, node.loc.end ?? node.loc.start);
    this.sourceMap[block.id] = {
      file, line: start.line, column: start.column, endLine: end.line, endColumn: end.column,
    };
  }

  /** Moves a source comment onto the corresponding Entry block. */
  applyComment(node, block) {
    if (!block) return block;
    const text = this.comments.get(commentKey(node));
    if (text) block.comment = makeComment(text);
    return block;
  }

  /** Number literal block. */
  number(value) {
    return this.block('number', [String(value)]);
  }

  /** String literal block. */
  text(value) {
    return this.block('text', [String(value)]);
  }

  /** Angle literal block (rotation-family blocks only). */
  angle(value) {
    return this.block('angle', [String(value)]);
  }

  // --- symbol lookup -----------------------------------------------------------
  /** Looks up a variable/list by name: function-local -> object-local -> global. */
  lookupVariable(name) {
    if (this.funcScope) {
      if (this.funcScope.params.has(name)) return { kind: 'param', name };
      // Entry function-local variables are referenced by `funcId_hash`, not by name
      if (this.funcScope.localVars.has(name)) {
        return { kind: 'funcLocal', name, id: this.funcScope.localVars.get(name) };
      }
      const global = this.globals.get(name);
      return global ? { kind: 'variable', entry: global } : null;
    }
    const local = this.locals.get(name);
    if (local) return { kind: 'variable', entry: local };
    const global = this.globals.get(name);
    return global ? { kind: 'variable', entry: global } : null;
  }

  /** Object name -> Entry object id. */
  objectId(name) {
    return this.objectByName.get(name)?.id ?? null;
  }

  /** Message name -> Entry message id, creating one if it doesn't exist. */
  messageId(name) {
    let message = this.messageByName.get(name);
    if (!message) {
      message = { id: this.newId(), name };
      this.messages.push(message);
      this.messageByName.set(name, message);
    }
    return message.id;
  }
}
