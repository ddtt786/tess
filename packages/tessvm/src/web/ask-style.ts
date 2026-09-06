/**
 * @fileoverview Style for the answer field `ask` puts on the stage.
 *
 * `Entry.stage.showInputField` draws it into the 640×360 canvas: a 546×50 box at
 * (15, 275) and a 54×54 submit button just after it, so every measurement here is
 * that fraction of the stage. Sizes that are not fractions — the text, the corner
 * radius, the border — read `--tessvm-stage-width`, which the runner writes with
 * the canvas' own width whenever it lays out.
 */
export const ASK_FIELD_STYLE = `
.tessvm-ask {
  --ask-unit: calc(var(--tessvm-stage-width, 640px) / 640);
  position: absolute;
  left: 2.344%;
  top: 76.389%;
  width: 95.625%;
  height: 15%;
  display: flex;
  align-items: flex-start;
  gap: 2.01%;
  margin: 0;
  padding: 0;
  border: 0;
  line-height: normal;
  font-size: calc(var(--ask-unit) * 20);
}

.tessvm-ask[hidden] { display: none; }

.tessvm-ask input {
  flex: 1 1 auto;
  min-width: 0;
  height: 92.6%;
  margin: 0;
  padding: 0 calc(var(--ask-unit) * 13);
  box-sizing: border-box;
  font: inherit;
  font-family: 'Nanum Gothic', sans-serif;
  color: #2c313d;
  background: #fff;
  border: calc(var(--ask-unit) * 2) solid #e2e2e2;
  border-radius: calc(var(--ask-unit) * 10);
  outline: none;
  box-shadow: none;
}

.tessvm-ask button {
  flex: none;
  width: 8.78%;
  aspect-ratio: 1;
  padding: calc(var(--ask-unit) * 9);
  box-sizing: border-box;
  border: 0;
  border-radius: calc(var(--ask-unit) * 9);
  background: #4f80ff;
  color: #fff;
  cursor: pointer;
  line-height: 0;
}

.tessvm-ask button svg {
  width: 100%;
  height: 100%;
  fill: currentColor;
}
`;
