import { shortcutKey } from '../core/shortcuts.js';
import { Painter } from "../Painter.js";
import type { PainterOptions } from "../Painter.js";
import type { PainterMode, ToolName } from "../core/types.js";
import { icon } from "./icons.js";
import { injectStyles } from "./styles.js";

export interface PainterUIOptions extends PainterOptions {
  /** Show the document-name field in the top bar. */
  showName?: boolean;
  name?: string;
  /** Fit the canvas to the viewport on start and after a mode switch. */
  fitOnStart?: boolean;
  /** Text overrides; every string the UI renders lives here. */
  labels?: Partial<typeof KO>;
}

/** Default (Korean) strings. Pass `labels` to override any of them. */
const KO = {
  vector: "벡터",
  bitmap: "비트맵",
  undo: "실행 취소",
  redo: "다시 실행",

  sectionFill: "채우기",
  sectionStroke: "선",
  sectionBrush: "붓",
  sectionText: "글자",
  sectionBucket: "채우기 도구",
  sectionArrange: "배치",
  sectionEdit: "편집",

  color: "색",
  transparent: "투명",
  width: "두께",
  size: "크기",
  font: "글꼴",
  align: "정렬",
  alignLeft: "왼쪽 정렬",
  alignCenter: "가운데 정렬",
  alignRight: "오른쪽 정렬",
  outlineOnly: "외곽선만",
  tolerance: "허용 오차",
  contiguous: "이어진 영역만",
  gapTolerance: "틈새 닫기",
  bleed: "영역 확장",

  group: "그룹",
  ungroup: "그룹 해제",
  toFront: "맨 앞으로",
  forward: "앞으로",
  backward: "뒤로",
  toBack: "맨 뒤로",
  flipH: "좌우 뒤집기",
  flipV: "상하 뒤집기",

  copy: "복사",
  paste: "붙여넣기",
  duplicate: "복제",
  remove: "삭제",
  selectAll: "모두 선택",
  deselect: "선택 해제",
  clear: "전체 지우기",

  zoomIn: "확대",
  zoomOut: "축소",
  zoomFit: "화면에 맞추기",
  zoomReset: "실제 크기",
  toolLabel: "도구",
  selectionNone: "선택 없음",
  selectionCount: (n: number) => `${n}개 선택됨`,
  selectionRegion: "영역 선택됨",

  tools: {
    select: "선택",
    reshape: "점 편집",
    brush: "붓",
    eraser: "지우개",
    fill: "채우기",
    text: "글자",
    line: "선",
    ellipse: "원",
    rect: "사각형",
    marquee: "영역 선택",
  } as Record<string, string>,
};

interface ToolEntry {
  name: ToolName;
  icon: string;
  label: string;
  key: string;
}

const VECTOR_TOOLS: ToolEntry[] = [
  { name: "select", icon: "select", label: "select", key: "V" },
  { name: "reshape", icon: "reshape", label: "reshape", key: "A" },
  { name: "brush", icon: "brush", label: "brush", key: "B" },
  { name: "eraser", icon: "eraser", label: "eraser", key: "E" },
  { name: "fill", icon: "fill", label: "fill", key: "F" },
  { name: "text", icon: "text", label: "text", key: "T" },
  { name: "line", icon: "line", label: "line", key: "L" },
  { name: "ellipse", icon: "ellipse", label: "ellipse", key: "O" },
  { name: "rect", icon: "rect", label: "rect", key: "R" },
];

const BITMAP_TOOLS: ToolEntry[] = [
  { name: "select", icon: "marquee", label: "marquee", key: "V" },
  { name: "brush", icon: "brush", label: "brush", key: "B" },
  { name: "eraser", icon: "eraser", label: "eraser", key: "E" },
  { name: "fill", icon: "fill", label: "fill", key: "F" },
  { name: "text", icon: "text", label: "text", key: "T" },
  { name: "line", icon: "line", label: "line", key: "L" },
  { name: "ellipse", icon: "ellipse", label: "ellipse", key: "O" },
  { name: "rect", icon: "rect", label: "rect", key: "R" },
];

const FONTS = [
  "Pretendard, system-ui, sans-serif",
  '"Noto Sans KR", sans-serif',
  '"Nanum Gothic", sans-serif',
  "Georgia, serif",
  '"Courier New", monospace',
];
const FONT_NAMES = ["기본 고딕", "노토 산스", "나눔고딕", "세리프", "고정폭"];

/**
 * Built-in editor shell: tool rail on the left, canvas in the middle,
 * property inspector on the right, status bar underneath.
 *
 * Everything is plain DOM with `pt-` classes, so it can be restyled or thrown
 * away in favour of a framework component — `Painter` is the real API.
 */
export class PainterUI {
  readonly painter: Painter;
  readonly root: HTMLDivElement;
  readonly rail: HTMLElement;
  readonly stage: HTMLDivElement;
  readonly inspector: HTMLElement;

  private readonly L: typeof KO;
  private readonly offs: Array<() => void> = [];
  private readonly topbar: HTMLElement;
  private readonly statusbar: HTMLElement;
  private nameInput: HTMLInputElement | null = null;
  private modeButtons = new Map<PainterMode, HTMLButtonElement>();
  private undoBtn: HTMLButtonElement | null = null;
  private redoBtn: HTMLButtonElement | null = null;
  private zoomValue: HTMLButtonElement | null = null;
  private statusTool: HTMLElement | null = null;
  private statusSelection: HTMLElement | null = null;
  private statusSize: HTMLElement | null = null;
  private syncers: Array<() => void> = [];

  constructor(container: HTMLElement, options: PainterUIOptions = {}) {
    injectStyles();
    this.L = {
      ...KO,
      ...options.labels,
      tools: { ...KO.tools, ...options.labels?.tools },
    };

    this.root = document.createElement("div");
    this.root.className = "pt-app";
    this.topbar = document.createElement("header");
    this.topbar.className = "pt-topbar";
    const workspace = document.createElement("div");
    workspace.className = "pt-workspace";
    this.rail = document.createElement("nav");
    this.rail.className = "pt-rail";
    this.stage = document.createElement("div");
    this.stage.className = "pt-stage";
    this.inspector = document.createElement("aside");
    this.inspector.className = "pt-inspector";
    this.statusbar = document.createElement("footer");
    this.statusbar.className = "pt-statusbar";
    workspace.append(this.rail, this.stage, this.inspector);
    this.root.append(this.topbar, workspace, this.statusbar);
    container.appendChild(this.root);

    this.painter = new Painter(this.stage, options);

    if (options.showName !== false) {
      this.nameInput = document.createElement("input");
      this.nameInput.className = "pt-doc-name";
      this.nameInput.value = options.name ?? "그림1";
      this.nameInput.spellcheck = false;
    }

    this.renderTopbar();
    this.renderRail();
    this.renderInspector();
    this.renderStatusbar();

    this.offs.push(
      this.painter.on("modechange", () => {
        this.renderRail();
        this.renderInspector();
        this.syncAll();
        if (options.fitOnStart !== false) this.fitLater();
      }),
      this.painter.on("toolchange", () => this.syncAll()),
      this.painter.on("historychange", () => this.syncAll()),
      this.painter.on("selectionchange", () => this.syncAll()),
      this.painter.on("stylechange", () => this.syncAll()),
      this.painter.on("change", () => this.syncAll()),
      this.painter.on("viewchange", () => this.syncZoom()),
    );

    const onKey = (e: KeyboardEvent) => this.onShortcut(e);
    this.root.addEventListener("keydown", onKey);
    this.offs.push(() => this.root.removeEventListener("keydown", onKey));

    if (options.fitOnStart !== false) this.fitLater();
    this.syncAll();
  }

  get name(): string {
    return this.nameInput?.value ?? "";
  }
  set name(value: string) {
    if (this.nameInput) this.nameInput.value = value;
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.painter.destroy();
    this.root.remove();
  }

  /* ---------------------------------------------------------------- *
   * Shell
   * ---------------------------------------------------------------- */

  private renderTopbar(): void {
    this.topbar.replaceChildren();
    const doc = document.createElement("div");
    doc.className = "pt-doc";
    const mark = document.createElement("div");
    mark.className = "pt-doc-mark";
    mark.innerHTML =
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><circle cx="11" cy="11" r="2"/></svg>';
    doc.append(mark);
    if (this.nameInput) doc.append(this.nameInput);
    this.topbar.append(doc, this.spacer());

    const segmented = document.createElement("div");
    segmented.className = "pt-segmented";
    for (const mode of ["vector", "bitmap"] as PainterMode[]) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = mode === "vector" ? this.L.vector : this.L.bitmap;
      btn.addEventListener("click", () => {
        if (this.painter.mode === mode) return;
        for (const b of this.modeButtons.values()) b.disabled = true;
        void this.painter.setMode(mode).finally(() => {
          for (const b of this.modeButtons.values()) b.disabled = false;
          this.syncAll();
        });
      });
      this.modeButtons.set(mode, btn);
      segmented.append(btn);
    }
    this.topbar.append(segmented, this.spacer());

    this.undoBtn = this.iconButton("undo", this.L.undo, () =>
      this.painter.undo(),
    );
    this.redoBtn = this.iconButton("redo", this.L.redo, () =>
      this.painter.redo(),
    );
    const group = document.createElement("div");
    group.className = "pt-grid-2";
    group.style.width = "84px";
    group.append(this.undoBtn, this.redoBtn);
    this.topbar.append(group);
  }

  private renderRail(): void {
    this.rail.replaceChildren();
    const tools = this.painter.isVector ? VECTOR_TOOLS : BITMAP_TOOLS;
    for (const entry of tools) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pt-rail-tool";
      btn.dataset.tool = entry.name;
      btn.title = `${this.L.tools[entry.label] ?? entry.label} (${entry.key})`;
      btn.setAttribute("aria-label", btn.title);
      btn.innerHTML = icon(entry.icon);
      btn.addEventListener("click", () => this.painter.setTool(entry.name));
      this.rail.append(btn);
    }
  }

  private renderStatusbar(): void {
    this.statusbar.replaceChildren();
    this.statusSize = document.createElement("span");
    this.statusSize.className = "pt-status-item";
    this.statusTool = document.createElement("span");
    this.statusTool.className = "pt-status-item";
    this.statusSelection = document.createElement("span");
    this.statusSelection.className = "pt-status-item";
    this.statusbar.append(
      this.statusSize,
      this.statusTool,
      this.statusSelection,
      this.spacer(),
    );

    const zoom = document.createElement("div");
    zoom.className = "pt-zoom";
    this.zoomValue = document.createElement("button");
    this.zoomValue.type = "button";
    this.zoomValue.className = "pt-zoom-value";
    this.zoomValue.title = this.L.zoomReset;
    this.zoomValue.addEventListener("click", () => this.painter.resetZoom());
    zoom.append(
      this.toggleButton("zoomOut", this.L.zoomOut, () =>
        this.painter.zoomOut(),
      ),
      this.zoomValue,
      this.toggleButton("zoomIn", this.L.zoomIn, () => this.painter.zoomIn()),
      this.toggleButton("zoomFit", this.L.zoomFit, () =>
        this.painter.zoomToFit(),
      ),
    );
    this.statusbar.append(zoom);
  }

  /* ---------------------------------------------------------------- *
   * Inspector
   * ---------------------------------------------------------------- */

  private renderInspector(): void {
    this.inspector.replaceChildren();
    this.syncers = [];
    const vector = this.painter.isVector;

    // 채우기 ---------------------------------------------------------
    this.inspector.append(
      this.section(this.L.sectionFill, [
        this.colorRow(
          () => this.painter.style.fill,
          (value) => this.painter.setFill(value),
        ),
      ]),
    );

    // 선 -------------------------------------------------------------
    const strokeRows: HTMLElement[] = [];
    if (vector) {
      strokeRows.push(
        this.colorRow(
          () => this.painter.style.stroke,
          (value) => this.painter.setStroke(value),
        ),
      );
    }
    strokeRows.push(
      this.sliderRow(
        this.L.width,
        0,
        120,
        1,
        () => this.painter.style.strokeWidth,
        (v) => this.painter.setStrokeWidth(v),
      ),
    );
    if (!vector) {
      strokeRows.push(
        this.checkRow(
          this.L.outlineOnly,
          () => this.painter.bitmap?.outlineShapes ?? false,
          (on) => {
            if (this.painter.bitmap) this.painter.bitmap.outlineShapes = on;
          },
        ),
      );
    }
    this.inspector.append(this.section(this.L.sectionStroke, strokeRows));

    // 붓 -------------------------------------------------------------
    this.inspector.append(
      this.section(this.L.sectionBrush, [
        this.sliderRow(
          this.L.size,
          1,
          200,
          1,
          () => this.painter.brush.size,
          (v) => this.painter.setBrushOptions({ size: v }),
        ),
      ]),
    );

    // 글자 -----------------------------------------------------------
    this.inspector.append(
      this.section(this.L.sectionText, [
        this.sliderRow(
          this.L.size,
          8,
          400,
          1,
          () => this.painter.textStyle.fontSize,
          (v) => this.painter.setTextStyle({ fontSize: v }),
        ),
        this.fontRow(),
        this.alignRow(),
      ]),
    );

    // 채우기 도구 (벡터 / 비트맵) -----------------------------------
    if (vector) {
      this.inspector.append(
        this.section(this.L.sectionBucket, [
          this.sliderRow(
            this.L.gapTolerance,
            0,
            24,
            1,
            () => this.painter.vector?.fillGapTolerance ?? 8,
            (v) => {
              if (this.painter.vector) this.painter.vector.fillGapTolerance = v;
            },
            "px",
          ),
          this.sliderRow(
            this.L.bleed,
            0,
            6,
            0.2,
            () => this.painter.vector?.fillBleed ?? 1.6,
            (v) => {
              if (this.painter.vector) this.painter.vector.fillBleed = v;
            },
            "px",
          ),
        ]),
      );
    } else {
      this.inspector.append(
        this.section(this.L.sectionBucket, [
          this.sliderRow(
            this.L.tolerance,
            0,
            100,
            1,
            () =>
              Math.round((this.painter.bitmap?.fillTolerance ?? 0.08) * 100),
            (v) => {
              if (this.painter.bitmap)
                this.painter.bitmap.fillTolerance = v / 100;
            },
            "%",
          ),
          this.checkRow(
            this.L.contiguous,
            () => this.painter.bitmap?.fillContiguous ?? true,
            (on) => {
              if (this.painter.bitmap) this.painter.bitmap.fillContiguous = on;
            },
          ),
        ]),
      );
    }

    // 배치 -----------------------------------------------------------
    const arrange: HTMLElement[] = [];
    if (vector) {
      arrange.push(
        this.buttonGrid(2, [
          ["group", this.L.group, () => this.painter.group(), "selection"],
          [
            "ungroup",
            this.L.ungroup,
            () => this.painter.ungroup(),
            "selection",
          ],
        ]),
        this.buttonGrid(
          4,
          [
            [
              "front",
              this.L.toFront,
              () => this.painter.bringToFront(),
              "selection",
            ],
            [
              "forward",
              this.L.forward,
              () => this.painter.bringForward(),
              "selection",
            ],
            [
              "backward",
              this.L.backward,
              () => this.painter.sendBackward(),
              "selection",
            ],
            [
              "back",
              this.L.toBack,
              () => this.painter.sendToBack(),
              "selection",
            ],
          ],
          true,
        ),
      );
    }
    arrange.push(
      this.buttonGrid(1, [
        ["flipH", this.L.flipH, () => this.painter.flipHorizontal()],
      ]),
      this.buttonGrid(1, [
        ["flipV", this.L.flipV, () => this.painter.flipVertical()],
      ]),
    );
    this.inspector.append(this.section(this.L.sectionArrange, arrange));

    // 편집 -----------------------------------------------------------
    const edit: HTMLElement[] = [
      this.buttonGrid(
        vector ? 4 : 3,
        vector
          ? [
              ["copy", this.L.copy, () => this.painter.copy(), "selection"],
              ["paste", this.L.paste, () => void this.painter.paste()],
              [
                "duplicate",
                this.L.duplicate,
                () => this.painter.vector?.duplicate(),
                "selection",
              ],
              [
                "trash",
                this.L.remove,
                () => this.painter.delete(),
                "selection",
              ],
            ]
          : [
              ["copy", this.L.copy, () => this.painter.copy()],
              ["paste", this.L.paste, () => void this.painter.paste()],
              [
                "trash",
                this.L.remove,
                () => this.painter.delete(),
                "selection",
              ],
            ],
        true,
      ),
      this.buttonGrid(2, [
        ["selectAll", this.L.selectAll, () => this.painter.selectAll()],
        [
          "deselect",
          this.L.deselect,
          () => this.painter.deselect(),
          "selection",
        ],
      ]),
      this.buttonGrid(1, [
        ["none", this.L.clear, () => this.painter.clear(), undefined, true],
      ]),
    ];
    this.inspector.append(this.section(this.L.sectionEdit, edit));
  }

  /* ---------------------------------------------------------------- *
   * Builders
   * ---------------------------------------------------------------- */

  private spacer(): HTMLSpanElement {
    const s = document.createElement("span");
    s.className = "pt-spacer";
    return s;
  }

  private section(title: string, rows: HTMLElement[]): HTMLElement {
    const section = document.createElement("section");
    section.className = "pt-section";
    const heading = document.createElement("span");
    heading.className = "pt-section-title";
    heading.textContent = title;
    section.append(heading, ...rows);
    return section;
  }

  /** Colour swatch plus a "transparent" toggle, both kept in sync. */
  private colorRow(
    get: () => string | null,
    set: (value: string | null) => void,
  ): HTMLElement {
    const row = document.createElement("div");
    row.className = "pt-row";

    const swatch = document.createElement("label");
    swatch.className = "pt-swatch";
    const preview = document.createElement("span");
    const input = document.createElement("input");
    input.type = "color";
    input.addEventListener("input", () => set(input.value));
    swatch.append(preview, input);

    const none = document.createElement("button");
    none.type = "button";
    none.className = "pt-toggle";
    none.title = this.L.transparent;
    none.innerHTML = icon("none");
    none.addEventListener("click", () =>
      set(get() === null ? input.value || "#000000" : null),
    );

    row.append(swatch, none);
    this.syncers.push(() => {
      const value = get();
      swatch.classList.toggle("is-none", value === null);
      none.classList.toggle("is-active", value === null);
      preview.style.background = value ?? "transparent";
      if (value && /^#[0-9a-f]{6}$/i.test(value)) input.value = value;
    });
    return row;
  }

  private sliderRow(
    label: string,
    min: number,
    max: number,
    step: number,
    get: () => number,
    set: (value: number) => void,
    unit?: string,
  ): HTMLElement {
    const row = document.createElement("div");
    row.className = "pt-row";
    const name = document.createElement("span");
    name.className = "pt-row-label";
    name.textContent = label;

    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "pt-slider";
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);

    const field = document.createElement("div");
    field.className = "pt-field";
    field.style.flex = "0 0 66px";
    const number = document.createElement("input");
    number.type = "number";
    number.min = String(min);
    number.max = String(max);
    number.step = String(step);
    field.append(number);
    if (unit) {
      const u = document.createElement("span");
      u.className = "pt-unit";
      u.textContent = unit;
      field.append(u);
    }

    const commit = (raw: number) => {
      if (!Number.isFinite(raw)) return;
      set(Math.min(max, Math.max(min, raw)));
    };
    slider.addEventListener("input", () => commit(Number(slider.value)));
    number.addEventListener("change", () => commit(Number(number.value)));

    row.append(name, slider, field);
    this.syncers.push(() => {
      const value = get();
      if (document.activeElement !== slider) slider.value = String(value);
      if (document.activeElement !== number) number.value = String(value);
    });
    return row;
  }

  private checkRow(
    label: string,
    get: () => boolean,
    set: (on: boolean) => void,
  ): HTMLElement {
    const row = document.createElement("div");
    row.className = "pt-row";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pt-btn";
    btn.style.flex = "1 1 auto";
    btn.textContent = label;
    btn.addEventListener("click", () => {
      set(!get());
      this.syncAll();
    });
    row.append(btn);
    this.syncers.push(() => btn.classList.toggle("is-active", get()));
    return row;
  }

  private fontRow(): HTMLElement {
    const row = document.createElement("div");
    row.className = "pt-row";
    const name = document.createElement("span");
    name.className = "pt-row-label";
    name.textContent = this.L.font;
    const field = document.createElement("div");
    field.className = "pt-field";
    const select = document.createElement("select");
    FONTS.forEach((family, i) => {
      const option = document.createElement("option");
      option.value = family;
      option.textContent = FONT_NAMES[i];
      select.append(option);
    });
    select.addEventListener("change", () =>
      this.painter.setTextStyle({ fontFamily: select.value }),
    );
    field.append(select);
    row.append(name, field);
    this.syncers.push(() => {
      const current = this.painter.textStyle.fontFamily;
      if (FONTS.includes(current)) select.value = current;
    });
    return row;
  }

  private alignRow(): HTMLElement {
    const row = document.createElement("div");
    row.className = "pt-row";
    const name = document.createElement("span");
    name.className = "pt-row-label";
    name.textContent = this.L.align;
    const grid = document.createElement("div");
    grid.className = "pt-grid";
    grid.style.flex = "1 1 auto";
    grid.style.gridTemplateColumns = "repeat(3, 1fr)";
    const entries: Array<["left" | "center" | "right", string, string]> = [
      ["left", "alignLeft", this.L.alignLeft],
      ["center", "alignCenter", this.L.alignCenter],
      ["right", "alignRight", this.L.alignRight],
    ];
    for (const [value, iconName, title] of entries) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pt-btn is-icon";
      btn.title = title;
      btn.innerHTML = icon(iconName);
      btn.addEventListener("click", () =>
        this.painter.setTextStyle({ align: value }),
      );
      grid.append(btn);
      this.syncers.push(() =>
        btn.classList.toggle(
          "is-active",
          this.painter.textStyle.align === value,
        ),
      );
    }
    row.append(name, grid);
    return row;
  }

  private buttonGrid(
    columns: number,
    entries: Array<
      [string, string, () => void, ("selection" | undefined)?, boolean?]
    >,
    iconOnly = false,
  ): HTMLElement {
    const grid = document.createElement("div");
    grid.className = "pt-row";
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
    grid.style.gap = "6px";
    for (const [iconName, title, onClick, requires, danger] of entries) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `pt-btn${iconOnly ? " is-icon" : ""}${danger ? " is-danger" : ""}`;
      btn.title = title;
      btn.innerHTML = iconOnly
        ? icon(iconName)
        : `${icon(iconName)}<span>${title}</span>`;
      btn.addEventListener("click", () => {
        onClick();
        this.syncAll();
      });
      grid.append(btn);
      if (requires === "selection")
        this.syncers.push(() => {
          btn.disabled = !this.hasSelection();
        });
    }
    return grid;
  }

  private iconButton(
    iconName: string,
    title: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pt-btn is-icon";
    btn.title = title;
    btn.innerHTML = icon(iconName);
    btn.addEventListener("click", () => {
      onClick();
      this.syncAll();
    });
    return btn;
  }

  private toggleButton(
    iconName: string,
    title: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pt-toggle";
    btn.title = title;
    btn.innerHTML = icon(iconName);
    btn.addEventListener("click", onClick);
    return btn;
  }

  /* ---------------------------------------------------------------- *
   * Sync
   * ---------------------------------------------------------------- */

  private hasSelection(): boolean {
    const vector = this.painter.vector;
    if (vector) return vector.selection.length > 0;
    return !!this.painter.bitmap?.floating;
  }

  private syncAll(): void {
    for (const [mode, btn] of this.modeButtons)
      btn.classList.toggle("is-active", this.painter.mode === mode);
    if (this.undoBtn) this.undoBtn.disabled = !this.painter.canUndo;
    if (this.redoBtn) this.redoBtn.disabled = !this.painter.canRedo;
    for (const btn of Array.from(
      this.rail.querySelectorAll<HTMLButtonElement>(".pt-rail-tool"),
    )) {
      btn.classList.toggle("is-active", btn.dataset.tool === this.painter.tool);
    }
    for (const sync of this.syncers) sync();
    this.syncStatus();
    this.syncZoom();
  }

  private syncStatus(): void {
    if (this.statusSize) {
      this.statusSize.innerHTML = "<b></b>";
      this.statusSize.querySelector("b")!.textContent =
        `${this.painter.width} × ${this.painter.height}`;
    }
    if (this.statusTool) {
      const tools = this.painter.isVector ? VECTOR_TOOLS : BITMAP_TOOLS;
      const entry = tools.find((t) => t.name === this.painter.tool);
      this.statusTool.innerHTML = `${this.L.toolLabel} <b></b>`;
      this.statusTool.querySelector("b")!.textContent = entry
        ? this.L.tools[entry.label]
        : this.painter.tool;
    }
    if (this.statusSelection) {
      const vector = this.painter.vector;
      if (vector) {
        const n = vector.selection.length;
        this.statusSelection.textContent = n
          ? this.L.selectionCount(n)
          : this.L.selectionNone;
      } else {
        this.statusSelection.textContent = this.painter.bitmap?.floating
          ? this.L.selectionRegion
          : this.L.selectionNone;
      }
    }
  }

  private syncZoom(): void {
    if (this.zoomValue)
      this.zoomValue.textContent = `${Math.round(this.painter.zoom * 100)}%`;
  }

  private fitLater(): void {
    // A timeout (not rAF) so this still runs in a backgrounded tab.
    setTimeout(() => this.painter.zoomToFit(), 0);
  }

  private onShortcut(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT")
    )
      return;
    const tools = this.painter.isVector ? VECTOR_TOOLS : BITMAP_TOOLS;
    const entry = tools.find(
      (t) => t.key.toLowerCase() === shortcutKey(e),
    );
    if (!entry) return;
    this.painter.setTool(entry.name);
    e.preventDefault();
  }
}

/** Convenience wrapper: mounts the editor shell and returns it. */
export function createPainterUI(
  container: HTMLElement,
  options: PainterUIOptions = {},
): PainterUI {
  return new PainterUI(container, options);
}
