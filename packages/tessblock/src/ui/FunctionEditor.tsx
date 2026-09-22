/**
 * Function editor, in the shape entry uses: a definition block in its own
 * workspace, parameters edited on the block itself, and the body built from
 * the same palette as everything else.
 */
import { useSignalEffect } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import * as Blockly from 'blockly/core';
import { DEFINE_BLOCK, refreshParams } from '../blocks/functions.ts';
import { TOOLBOX, flyoutFor, installBlocks } from '../blocks/registry.ts';
import { CATEGORY_ORDER } from '../blocks/theme.ts';
import { editingFunction } from '../model/function-editing.ts';
import { newId } from '../model/ids.ts';
import { removeFunction, saveFunction } from '../model/store.ts';
import { WORKSPACE_OPTIONS } from './blockly-host.ts';
import { functionDraft, notify } from './state.ts';
import type { FunctionDef, FunctionParam, FunctionParamKind } from '../model/types.ts';

export function FunctionEditor() {
  const draft = functionDraft.value;
  const host = useRef<HTMLDivElement>(null);
  const workspace = useRef<Blockly.WorkspaceSvg | null>(null);

  useSignalEffect(() => {
    editingFunction.value = functionDraft.value;
  });

  useEffect(() => {
    if (!draft || !host.current) return undefined;
    installBlocks();
    const created = Blockly.inject(host.current, { ...WORKSPACE_OPTIONS, toolbox: TOOLBOX });
    for (const category of CATEGORY_ORDER) {
      created.registerToolboxCategoryCallback(`TESS_${category}`, () => flyoutFor(category) as never);
    }
    const flyout = created.getFlyout();
    if (flyout) flyout.autoClose = false;
    // Open on 함수 so the parameters are within reach.
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
      drawParams(define, draft.params);
      created.centerOnBlock(define.id);
    }
    setTimeout(() => Blockly.svgResize(created), 0);
    return () => {
      created.dispose();
      workspace.current = null;
    };
  }, [draft?.id]);

  if (!draft) return null;

  function drawParams(block: Blockly.Block, params: FunctionParam[]) {
    refreshParams(block, params, {
      rename(id, name) {
        const current = functionDraft.peek();
        const param = current?.params.find((candidate) => candidate.id === id);
        // A field reports its starting value too; only a real change counts,
        // or drawing the fields would set them again without end.
        if (!current || !param || param.name === name) return;
        publish({
          ...current,
          params: current.params.map((candidate) => (candidate.id === id ? { ...candidate, name } : candidate)),
        });
      },
      remove(id) {
        const current = functionDraft.peek();
        if (!current) return;
        applyParams(current.params.filter((param) => param.id !== id));
      },
    });
  }

  function applyParams(params: FunctionParam[]) {
    const current = functionDraft.peek();
    if (!current) return;
    publish({ ...current, params });
    const define = workspace.current ? definitionBlock(workspace.current) : null;
    if (define) drawParams(define, params);
  }

  /** Parameter blocks read the function being edited, so it is set at once. */
  function publish(next: FunctionDef) {
    functionDraft.value = next;
    editingFunction.value = next;
    workspace.current?.getToolbox()?.refreshSelection();
  }

  function addParam(kind: FunctionParamKind) {
    const current = functionDraft.peek();
    if (!current) return;
    const count = current.params.filter((param) => param.kind === kind).length + 1;
    applyParams([
      ...current.params,
      { id: newId('p'), name: kind === 'boolean' ? `판단${count}` : `값${count}`, kind },
    ]);
  }

  function save() {
    const current = functionDraft.peek();
    if (!current || !workspace.current) return;
    const define = definitionBlock(workspace.current);
    const name = String(define?.getFieldValue('NAME') ?? current.name).trim() || '함수';
    saveFunction({
      ...current,
      name,
      blocks: Blockly.serialization.workspaces.save(workspace.current) as Record<string, unknown>,
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
        <strong class="func-title">함수 만들기</strong>
        <span class="vr" />
        <span class="lead">매개변수</span>
        <button class="btn" onClick={() => addParam('value')}>＋ 값</button>
        <button class="btn" onClick={() => addParam('boolean')}>＋ 판단</button>
        <span class="note-left">
          {draft.params.length
            ? draft.params.map((param) => `${param.name}${param.kind === 'boolean' ? '?' : ''}`).join(', ')
            : '블록 위의 이름과 매개변수를 눌러 고칠 수 있습니다'}
        </span>
        <span class="spacer" />
        <button
          class="btn ghost danger"
          onClick={() => {
            removeFunction(draft.id);
            close();
          }}
        >
          삭제
        </button>
        <button class="btn" onClick={close}>취소</button>
        <button class="btn primary" onClick={save}>저장하기</button>
      </div>
      <div class="canvas func-canvas">
        <div class="blockly-host" ref={host} />
      </div>
    </>
  );
}

function definitionBlock(workspace: Blockly.Workspace): Blockly.Block | null {
  return workspace.getTopBlocks(false).find((block) => block.type === DEFINE_BLOCK) ?? null;
}
