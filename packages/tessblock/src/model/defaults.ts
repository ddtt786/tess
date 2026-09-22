/**
 * @fileoverview The project a fresh editor starts with, and the costumes it
 * ships so a new object has something to draw.
 */
import { newId } from './ids.ts';
import { measureTextBox } from './text-metrics.ts';
import type { Costume, ObjectProps, Scene, TessObject, TessProject, TextProps } from './types.ts';

export interface CostumeTemplate {
  name: string;
  url: string;
  width: number;
  height: number;
}

/** Costumes served from `public/costumes`. */
export const COSTUME_LIBRARY: CostumeTemplate[] = [
  { name: '로봇', url: '/costumes/bot.svg', width: 120, height: 120 },
  { name: '로봇_인사', url: '/costumes/bot-wave.svg', width: 120, height: 120 },
  { name: '공', url: '/costumes/ball.svg', width: 80, height: 80 },
  { name: '상자', url: '/costumes/box.svg', width: 100, height: 100 },
];

export function costumeFrom(template: CostumeTemplate): Costume {
  return { id: newId('c'), ...template };
}

export function defaultProps(): ObjectProps {
  return {
    x: 0,
    y: 0,
    scaleX: 100,
    scaleY: 100,
    angle: 0,
    way: 90,
    rotation: 'free',
    visible: true,
    lock: false,
    center: null,
  };
}

export function defaultTextProps(content: string): TextProps {
  const text: TextProps = {
    content,
    font: '나눔고딕',
    fontSize: 20,
    color: '#000000',
    bgColor: null,
    align: 'left',
    lineBreak: false,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    boxWidth: 0,
    boxHeight: 0,
  };
  return { ...text, ...measureTextBox(text) };
}

/** A sprite with the given costume, ready to drop into a scene. */
export function makeSprite(name: string, sceneId: string, template = COSTUME_LIBRARY[0]!): TessObject {
  const costume = costumeFrom(template);
  return {
    id: newId('o'),
    name,
    kind: 'sprite',
    sceneId,
    costumes: [costume],
    selectedCostumeId: costume.id,
    sounds: [],
    props: defaultProps(),
    text: null,
    blocks: null,
  };
}

export function makeTextBox(name: string, sceneId: string, content = '안녕!'): TessObject {
  return {
    id: newId('o'),
    name,
    kind: 'text',
    sceneId,
    costumes: [],
    selectedCostumeId: '',
    sounds: [],
    props: defaultProps(),
    text: defaultTextProps(content),
    blocks: null,
  };
}

export function makeScene(name: string): Scene {
  return { id: newId('s'), name };
}

export function starterProject(): TessProject {
  const scene = makeScene('장면 1');
  return {
    name: '새 작품',
    description: '',
    fps: 60,
    scenes: [scene],
    objects: [makeSprite('로봇', scene.id)],
    variables: [],
    signals: [],
    functions: [],
    tables: [],
  };
}
