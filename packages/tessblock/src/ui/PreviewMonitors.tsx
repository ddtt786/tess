/**
 * Variable and list boxes on the stage before anything runs, placed and shaped
 * the way the runner draws them (`tessvm/src/render/overlay.ts`): a work that
 * says where a box sits is not written by tessblock, so every box takes entry's
 * own place — values and lists each stacked down columns, counted among all
 * the work's variables of their kind.
 */
import { currentScene, project } from '../model/store.ts';
import { STAGE } from './stage-geometry.ts';
import type { VariableDef } from '../model/types.ts';

/** `Overlay.homeOf`: entry's place for the index-th box of its kind; top left, y down from the stage middle. */
function homeOf(index: number, list: boolean): { x: number; y: number } {
  if (list) {
    return {
      x: -Math.floor((index % 24) / 6) * 110 + 120,
      y: index * 24 + 20 - 135 - Math.floor(index / 6) * 145,
    };
  }
  const column = Math.floor(index / 11);
  return { x: 10 - 240 + column * 80, y: index * 24 + 20 - 135 - column * 264 };
}

/** The runner's box height leaves room for this many list rows. */
const LIST_ROW_HEIGHT = 20;
const LIST_WIDTH = 100;
const LIST_HEIGHT = 120;

export function PreviewMonitors() {
  const model = project.value;
  const scene = currentScene.value?.id ?? '';
  // Written order: globals first, then each object's own, as the compiler lists them.
  const ordered = [
    ...model.variables.filter((variable) => !variable.owner),
    ...model.objects.flatMap((object) => model.variables.filter((variable) => variable.owner === object.id)),
  ];
  const sceneOf = new Map(model.objects.map((object) => [object.id, object.sceneId]));
  const values = ordered.filter((variable) => variable.kind !== 'list');
  const lists = ordered.filter((variable) => variable.kind === 'list');
  // An object's box shows only while that object's scene is on, as when running.
  const shows = (variable: VariableDef) => variable.visible && (!variable.owner || sceneOf.get(variable.owner) === scene);

  return (
    <>
      {values.map((variable, index) => {
        if (!shows(variable)) return null;
        const at = homeOf(index, false);
        return (
          <div
            key={variable.id}
            class="pm-value"
            style={{ left: `${at.x + STAGE.width / 2}px`, top: `${at.y + STAGE.height / 2 - 14}px` }}
          >
            <span class="pm-name">{variable.name}</span>
            <span class="pm-pill">{String(variable.value)}</span>
          </div>
        );
      })}
      {lists.map((variable, index) => {
        if (!shows(variable)) return null;
        const at = homeOf(index, true);
        const seats = Math.floor((LIST_HEIGHT - 15) / LIST_ROW_HEIGHT);
        return (
          <div
            key={variable.id}
            class="pm-list"
            style={{
              left: `${at.x + STAGE.width / 2}px`,
              top: `${at.y + STAGE.height / 2}px`,
              width: `${LIST_WIDTH + 7}px`,
              height: `${LIST_HEIGHT + 22}px`,
            }}
          >
            <div class="pm-list-title">{variable.name}</div>
            {variable.array.slice(0, seats).map((item, row) => (
              <div class="pm-row" key={row}>
                <span class="pm-row-no">{row + 1}</span>
                <span class="pm-row-value">{String(item)}</span>
              </div>
            ))}
            {!variable.array.length && <div class="pm-list-empty">(비어 있음)</div>}
          </div>
        );
      })}
    </>
  );
}
