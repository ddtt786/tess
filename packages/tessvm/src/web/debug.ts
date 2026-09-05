/**
 * @fileoverview 디버그 패널이 tessvm 을 몰 수 있게 하는 어댑터입니다.
 *
 * 패널(`@tess/player` 의 `debug-ui.ts`)은 실행기를 어댑터 하나로만 만납니다. 여기서
 * 그 어댑터를 VM 위에 만들어 `window.tessRuntime` 에 걸어 두면, 엔트리 실행기에서
 * 쓰던 그 패널이 그대로 tessvm 을 봅니다 — 실행 제어·변수·리스트·오브젝트·장면.
 */
import type { TessVmHandle } from './boot.ts';
import { stage, type Entity, type Target, type Variable } from '../runtime/model.ts';

/** What the panel's environment fields are set to; `""` means "as it really is". */
export interface EnvChoices {
  boost: string;
  device: string;
  touch: string;
}

/** The object shape the panel expects — entry's object, as far as the panel reads it. */
interface ObjectView {
  id: string;
  name: string;
  objectType: string;
  pictures: Target['pictures'];
  rotateMethod: string;
  getPicture(value: unknown): Target['pictures'][number] | null;
  setRotateMethod(method: string): void;
}

function objectView(target: Target): ObjectView {
  return {
    id: target.id,
    name: target.name,
    objectType: target.objectType,
    pictures: target.pictures,
    rotateMethod: target.rotateMethod,
    getPicture: (value: unknown) => target.getPicture(value),
    setRotateMethod(method: string) {
      target.rotateMethod = method;
      // The method decides the angle right away: anything but free rotation is 0.
      target.forEachEntity((entity) => {
        entity.setRotation(entity.rotation);
        entity.touch();
      });
    },
  };
}

/** Wraps a variable or a list in the shape the panel knows — entry's own API. */
function variableView(variable: Variable, redraw: () => void) {
  const seen = {
    getName: () => variable.name,
    isVisible: () => variable.visible,
    setVisible(visible: boolean) {
      variable.visible = Boolean(visible);
      redraw();
    },
  };
  if (variable.isList) {
    return {
      ...seen,
      getArray: () => variable.array,
      // Entry's list API counts from 1.
      replaceValue(index: number, data: string | number) {
        const item = variable.array[index - 1];
        if (item) {
          item.data = data;
        }
        redraw();
      },
      appendValue(data: string | number) {
        variable.array.push({ data });
        redraw();
      },
      deleteValue(index: number) {
        variable.array.splice(index - 1, 1);
        redraw();
      },
    };
  }
  return {
    ...seen,
    getValue: () => variable.getValue(),
    setValue(value: string | number) {
      variable.setValue(value);
      redraw();
    },
  };
}

/** The window the debug panel sees tessvm through. Install it as `window.tessRuntime`. */
export function makeVmRuntime(handle: TessVmHandle) {
  const { vm, renderer } = handle;
  const redraw = () => renderer.flush();
  const find = (id: string, list: boolean) =>
    vm.variables.find(
      (variable) => variable.id === id && variable.isList === list,
    ) ?? null;

  return {
    state: () => vm.state,
    run: () => handle.start(),
    /** Resumes when paused, holds when running — the panel drives both from one button. */
    pause: () => (vm.state === 'pause' ? handle.start() : handle.pause()),
    stop: () => handle.stop(),

    variable(id: string) {
      const variable = find(id, false);
      return variable ? variableView(variable, redraw) : null;
    },
    list(id: string) {
      const variable = find(id, true);
      return variable ? variableView(variable, redraw) : null;
    },
    sendSignal(id: string) {
      vm.fireEvent('when_message_cast', id);
    },

    object(objectId: string) {
      const target = vm.targetOf(objectId);
      return target ? { object: objectView(target), entity: target.entity } : null;
    },
    /** This scene's objects, front-most first — the order they are drawn in. */
    currentObjects() {
      return vm.currentTargets().map((target) => ({
        id: target.id,
        name: target.name,
        entity: target.entity as Entity,
      }));
    },
    /**
     * Whether the entity's own pixels cover this stage point — the same test
     * `when_object_click` uses. A costume with nothing at that spot answers no,
     * so an empty full-stage board stops swallowing every pick.
     */
    hitTest(entity: Entity, x: number, y: number): boolean {
      return vm.collision.touchingMouse(
        entity,
        x * stage.scale + stage.worldWidth / 2,
        -y * stage.scale + stage.worldHeight / 2,
      );
    },
    /** Jumps to a scene and runs it. Events are dropped unless the vm is running. */
    goToScene(sceneId: string) {
      if (vm.state !== 'run') {
        handle.start();
      }
      vm.selectScene(sceneId);
      vm.fireEvent('when_scene_start');
    },
    /** Draws one frame so edits show while the work is paused or stopped. */
    requestUpdate: redraw,

    /** tessvm always draws with WebGL. */
    realBoost: () => true,
    /**
     * Writes the panel's answers straight into the vm. Entry has to wrap the
     * block functions because they ask the browser; the vm keeps each answer in
     * a field of its own.
     */
    patchEnvironment(env: EnvChoices) {
      vm.boost = env.boost === '' ? handle.defaultBoost : env.boost === 'true';
      vm.touch = env.touch === '' ? handle.defaultTouch : env.touch === 'true';
      vm.deviceType = (env.device === ''
        ? handle.defaultDeviceType
        : env.device) as typeof vm.deviceType;
    },

    stageSize: () => ({ width: stage.width, height: stage.height }),
    stageCanvas: () => renderer.app.canvas as HTMLCanvasElement,
    layoutCanvas: () => handle.relayout(),
    /** Entry caches the canvas rect; here it is measured on every event anyway. */
    refreshRect: () => {},
  };
}
