/**
 * @fileoverview How sharp the things that go through a texture are drawn.
 *
 * A png costume goes to the screen as it is, but a text box and a vector costume
 * are baked into a texture first, and a texture is only as sharp as it was baked.
 * The size the canvas draws them at is what decides that — see AI_TESSVM.md 12.
 */

/**
 * Ceiling on how many texture pixels go on one stage pixel. The stage already
 * asks for about 1.3 at the default size on a plain screen, around 3 in a retina
 * window, and reaches this full screen on a large display.
 */
export const MAX_SHARPNESS = 8;
/** Least sharpness a text box is drawn with, whatever the canvas is doing. */
export const MIN_TEXT_SHARPNESS = 2;
/**
 * Least sharpness a vector costume is rasterised with. That extra detail is the
 * only reason to keep the vector at all; at 1× it carries the same as the raster
 * beside it and the canvas round trip only loses.
 */
export const MIN_SVG_SHARPNESS = 2;
/**
 * 벡터에는 "몇 배까지" 라는 고정 상한을 두지 않습니다. 고정 상한은 화면이 그보다 더
 * 촘촘할 때 텍스처를 화면보다 성기게 만들어 버립니다 — 전체 화면이나 큰 창에서는 무대
 * 배율만 8배에 가까운데 4배로 잘라 두면 화면 픽셀의 절반만 담게 되어, 벡터를 쓰는 의미가
 * 사라지고 옆의 png 와 다를 바 없이 보입니다(`play.ent` 의 단추가 그 자리였습니다).
 *
 * 대신 **화면이 요구하는 만큼**(1:1) 을 목표로 하고, 그 위는 아래의 픽셀 상한(긴 변
 * 4096px · 넓이 2048×2048)과 작품 전체 예산이 잡습니다.
 */
/**
 * 한 모양이 제 크기의 몇 배로 그려지는 것까지 따라가 줄지. 400% 로 키운 모양은 같은
 * 선명도를 내려면 텍스처도 네 배가 필요한데, 그 위로는 픽셀 상한이 어차피 잡습니다.
 */
export const MAX_SVG_SCALE = 4;
/**
 * 벡터 텍스처의 긴 변이 못해도 이만큼은 되게 합니다. 배율만으로 정하면 작게 저장된
 * 그림(20×20 아이콘 같은)은 4배를 줘도 80px 이라, 작품이 그것을 조금만 키워도 바로
 * 뭉갭니다. 무대가 480 이므로 그 폭만큼은 담고 있게 두는 것입니다 — 이 하한도 작품
 * 전체 예산에 함께 걸리므로, 작은 그림이 많은 작품에서는 예산이 도로 끌어내립니다.
 */
export const MIN_SVG_SIDE = 480;
/**
 * No texture may go past this on a side. It is the size every webgl
 * implementation is required to allow; asking for more fails the upload, and a
 * failed upload takes the whole renderer down rather than one costume.
 */
export const MAX_TEXTURE_SIDE = 4096;
/** And no vector costume past this many pixels — 16MB of texture. */
export const MAX_SVG_PIXELS = 2048 * 2048;
/**
 * Ceiling on the texture pixels every vector costume of one work takes together
 * — 256MB, four bytes to a pixel. A work carrying hundreds of full-stage
 * drawings would otherwise ask for gigabytes, and a card that cannot hold them
 * spends every frame moving textures instead of drawing.
 */
export const SVG_PIXEL_BUDGET = 64 * 1024 * 1024;

/** Stepping in halves keeps a texture from being baked again for every pixel. */
const stepped = (value: number) => Math.ceil(value * 2) / 2;

/**
 * Sharpness for a text box. `longest` is the text's own longest side in stage
 * units, which does not move with the resolution, so it is what says how sharp
 * the texture can be before it stops fitting.
 */
export function textSharpness(displayScale: number, scale: number, longest: number): number {
  const wanted = Math.min(MAX_SHARPNESS, stepped(displayScale * Math.abs(scale)));
  const bySide = MAX_TEXTURE_SIDE / Math.max(longest, 1);
  return Math.min(Math.max(MIN_TEXT_SHARPNESS, wanted), bySide);
}

/**
 * Sharpness a vector costume of this nominal size is rasterised with.
 *
 * `budget` scales the wanted sharpness down where the work has more vectors
 * than the card should hold at once — see `svgBudgetScale`.
 *
 * `scale` 은 작품이 이 모양을 실제로 그리는 가장 큰 배율입니다(1 이면 제 크기). 텍스처는
 * 이름 크기에서 구워지므로, 키워서 그리는 모양은 그만큼 더 촘촘히 구워야 화면에서 같은
 * 선명도가 납니다. 아래의 픽셀 상한이 그 위를 잡습니다.
 */
export function svgSharpness(
  displayScale: number,
  width: number,
  height: number,
  budget = 1,
  scale = 1,
): number {
  const w = Math.max(width, 1);
  const h = Math.max(height, 1);
  const drawn = Math.min(MAX_SVG_SCALE, Math.max(1, scale));
  // 화면 픽셀 하나에 텍스처 픽셀 하나 — 그것이 목표입니다. 하한 2배는 그보다 성긴
  // 화면에서도 옆의 png 보다는 나은 값을 담고 있게 하려는 것입니다.
  const asked = Math.max(MIN_SVG_SHARPNESS, displayScale * drawn);
  const share = Math.min(1, budget);
  // 긴 변이 `MIN_SVG_SIDE` 에 못 미치면 거기까지 끌어올립니다 — 작게 저장된 그림은
  // 화면이 요구하는 배율만으로는 몇십 픽셀짜리 텍스처가 되기 때문입니다.
  const byFloor = MIN_SVG_SIDE / Math.max(w, h);
  const wanted = Math.max(stepped(asked * share), stepped(byFloor * share));
  const bySide = MAX_TEXTURE_SIDE / Math.max(w, h);
  const byArea = Math.sqrt(MAX_SVG_PIXELS / (w * h));
  // The caps come last: a drawing already past the texture limit is rasterised
  // smaller than its own size rather than not at all.
  return Math.min(Math.max(1, wanted), bySide, byArea);
}

/**
 * How far every vector costume has to come down for the work's textures to fit
 * the budget together. 1 while they already do.
 *
 * Sharpness squares into pixels, so the room left over is shared by taking the
 * root — twice the drawings means each is rasterised at 1/√2 the sharpness.
 */
export function svgBudgetScale(wantedPixels: number, budget = SVG_PIXEL_BUDGET): number {
  if (wantedPixels <= budget) {
    return 1;
  }
  return Math.sqrt(budget / wantedPixels);
}
