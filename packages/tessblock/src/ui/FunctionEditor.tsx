/**
 * Function editor.
 *
 * The definition block holds the name and the parameters. A parameter is a
 * block: drag it out of the header to use it in the body — a copy stays in the
 * header — drop one into the empty slot to add it, and throw it away to remove
 * it. The buttons above do the same thing for anyone who would rather click.
 */
import { useEffect, useRef } from 'preact/hooks';
import * as Blockly from 'blockly/core';
import { DEFINE_BLOCK, PARAM_BOOLEAN, PARAM_VALUE, readParams, tidyHeader } from '../blocks/functions.ts';
import { TOOLBOX, flyoutFor, installBlocks } from '../blocks/registry.ts';
import { CATEGORY_ORDER } from '../blocks/theme.ts';
import { editingFunction } from '../model/function-editing.ts';
import { project, saveFunction } from '../model/store.ts';
import { WORKSPACE_OPTIONS } from './blockly-host.ts';
import { functionDraft, notify } from './state.ts';
import type { FunctionParam } from '../model/types.ts';

export function FunctionEditor() {
  const draft = functionDraft.value;
  const host = useRef<HTMLDivElement>(null);
  const workspace = useRef<Blockly.WorkspaceSvg | null>(null);
  const known = useRef<FunctionParam[]>([]);
  const settling = useRef(false);
  const exists = project.value.functions.some((candidate) => candidate.id === draft?.id);

  useEffect(() => {
    if (!draft || !host.current) return undefined;
    // The palette offers this function's parameters, so it has to know which
    // function is open before the first flyout is built.
    editingFunction.value = draft;
    installBlocks();
    const created = Blockly.inject(host.current, { ...WORKSPACE_OPTIONS, toolbox: TOOLBOX });
    for (const category of CATEGORY_ORDER) {
      created.registerToolboxCategoryCallback(`TESS_${category}`, () => flyoutFor(category) as never);
    }
    const flyout = created.getFlyout();
    if (flyout) flyout.autoClose = false;
    created.getToolbox()?.selectItemByPosition(CATEGORY_ORDER.indexOf('func'));
    workspace.current = created;

    if (draft.blocks) {
      Blockly.serialization.workspaces.load(draft.blocks as never, created, { recordUndo: false });
    } else {
      Blockly.serialization.blocks.append({ type: DEFINE_BLOCK, x: 60, y: 48 }, created);
    }
    const define = definitionBlock(created);
    if (define) {
      define.setFieldValue(draft.name, 'NAME');
      if (!draft.blocks) for (const param of draft.params) restore(define, param);
      tidyHeader(define);
      known.current = readParams(define);
      created.centerOnBlock(define.id);
    }
    created.addChangeListener(onChange);
    setTimeout(() => Blockly.svgResize(created), 0);
    return () => {
      created.dispose();
      workspace.current = null;
      editingFunction.value = null;
    };
  }, [draft?.id]);

  if (!draft) return null;

  /**
   * Follows the header after an edit: the slots stay tidy and the palette
   * offers whatever parameters the function now has. Taking a parameter out of
   * the header is handled by its own drag, not from here.
   */
  function onChange(event: Blockly.Events.Abstract): void {
    const created = workspace.current;
    const define = created ? definitionBlock(created) : null;
    if (!created || !define || settling.current || event.isUiEvent) return;
    settling.current = true;
    try {
      tidyHeader(define);
      const params = readParams(define);
      known.current = params;
      const current = functionDraft.peek();
      if (current && !sameParams(current.params, params)) {
        const next = { ...current, params };
        functionDraft.value = next;
        editingFunction.value = next;
        created.getToolbox()?.refreshSelection();
      }
    } finally {
      settling.current = false;
    }
  }

  function save() {
    const current = functionDraft.peek();
    const created = workspace.current;
    if (!current || !created) return;
    const define = definitionBlock(created);
    const name = String(define?.getFieldValue('NAME') ?? current.name).trim() || '함수';
    saveFunction({
      ...current,
      name,
      params: define ? readParams(define) : current.params,
      blocks: Blockly.serialization.workspaces.save(created) as Record<string, unknown>,
    });
    notify(`함수 '${name}' 을(를) 저장했습니다.`);
    close();
  }

  /** Leaves the editor; parameter blocks must stop being offered. */
  function close() {
    functionDraft.value = null;
    editingFunction.value = null;
  }

  return (
    <>
      <div class="tabbar func-bar">
        <strong class="func-title">{exists ? '함수 고치기' : '함수 만들기'}</strong>
        <span class="vr" />
        <span class="note-left">
          매개변수는 함수 블록의 ＋ 로 더하고, 쓰려면 그 매개변수를 그대로 끌어다 놓으세요
        </span>
        <span class="spacer" />
        <button class="btn" onClick={close}>취소</button>
        <button class="btn primary" onClick={save}>저장하기</button>
      </div>
      <div class="canvas func-canvas">
        <div class="blockly-host" ref={host} />
      </div>
    </>
  );
}

/** Puts a parameter block back in the header, keeping its id and name. */
function restore(define: Blockly.BlockSvg, param: FunctionParam, at?: number): void {
  const workspace = define.workspace as Blockly.WorkspaceSvg;
  const block = workspace.newBlock(param.kind === 'boolean' ? PARAM_BOOLEAN : PARAM_VALUE) as
    Blockly.BlockSvg & { paramId: string };
  block.paramId = param.id;
  block.setFieldValue(param.name, 'NAME');
  block.initSvg();
  block.render();

  const slots = define.inputList.filter((input) => input.name.startsWith('ARG'));
  const empty = slots.find((input, index) => (at === undefined || index >= at) && !input.connection?.targetBlock())
    ?? slots.find((input) => !input.connection?.targetBlock());
  empty?.connection?.connect(block.outputConnection!);
  tidyHeader(define);
}

function sameParams(left: FunctionParam[], right: FunctionParam[]): boolean {
  return left.length === right.length
    && left.every((param, index) => param.id === right[index]?.id && param.name === right[index]?.name);
}

function definitionBlock(workspace: Blockly.WorkspaceSvg): Blockly.BlockSvg | null {
  return workspace.getTopBlocks(false).find((block) => block.type === DEFINE_BLOCK) ?? null;
}
