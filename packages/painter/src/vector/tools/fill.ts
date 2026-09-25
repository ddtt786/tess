import type { Tool } from "../../core/tool.js";
import type { PointerInfo } from "../../core/types.js";
import { applyStyle, paintBoundsIn, readStyle } from "../scene.js";
import type { VectorPainter } from "../VectorPainter.js";

/**
 * Bucket fill for the vector surface:
 * 1. Recolours outlines (strokes) when clicked on strokes.
 * 2. Recolours existing closed shapes (even if previously transparent/unfilled) if standalone.
 * 3. Detects and fills enclosed regions formed by brush strokes, lines, and shapes.
 * 4. Never fills the whole canvas background on a miss or open canvas click.
 * 5. Alt-click picks up colours (eyedropper).
 */
export class FillTool implements Tool {
  readonly name = "fill";
  readonly cursor = "crosshair";

  constructor(private readonly painter: VectorPainter) {}

  activate(): void {
    this.painter.invalidateBarrierCache();
  }

  deactivate(): void {
    this.painter.clearFillPreview();
  }

  cancel(): void {
    this.painter.clearFillPreview();
  }

  onPointerDown(info: PointerInfo): void {
    this.painter.clearFillPreview();

    // 1. Alt-click: Eyedropper (color sampler)
    if (info.altKey) {
      const hit = this.painter.hitTest(info.clientX, info.clientY, 6, {
        includeUnfilled: true,
        ignoreBackground: false,
      });
      if (hit) {
        const current = readStyle(hit.node);
        const picked =
          hit.kind === "stroke"
            ? current.stroke
            : (current.fill ?? current.stroke);
        if (picked) this.painter.setFill(picked);
      } else {
        const bg = this.painter.background;
        if (bg) this.painter.setFill(bg);
      }
      return;
    }

    const fillColor = this.painter.style.fill;
    const isInk = this.painter.isInkAt(info.x, info.y);

    // 2. If clicking on empty pixels (crevice, interior, or open space), prioritize enclosed region
    if (!isInk && fillColor) {
      const d = this.painter.detectEnclosedRegion(info.x, info.y);
      if (d) {
        // Check if user clicked inside an existing basic closed shape
        const shapeHit = this.painter.hitTest(info.clientX, info.clientY, 2, {
          includeUnfilled: false,
          ignoreBackground: true,
        });
        if (shapeHit && shapeHit.kind === "fill") {
          const tag = shapeHit.node.tagName.toLowerCase();
          const current = readStyle(shapeHit.node);
          const isBrushRibbon =
            tag === "path" &&
            shapeHit.node.getAttribute("fill-rule") === "nonzero" &&
            !current.stroke;
          const isFillRegion =
            shapeHit.node.getAttribute("data-fill-region") === "true";

          if (!isBrushRibbon && !isFillRegion) {
            // Only recolor the whole shape if it has no dividing walls/strokes inside
            const scene = this.painter.scene.node as SVGGraphicsElement;
            const shapeBounds = paintBoundsIn(shapeHit.node, scene);
            const itemsInside = this.painter
              .itemsInRect(shapeBounds)
              .filter((it) => it !== this.painter.backgroundItem());
            if (itemsInside.length <= 1) {
              applyStyle(shapeHit.node, { fill: fillColor });
              this.painter.invalidateBarrierCache();
              this.painter.commit();
              this.onPointerHover(info);
              return;
            }
          }
        }

        const filled = this.painter.fillEnclosedRegion(info.x, info.y);
        if (filled) {
          this.onPointerHover(info);
          return;
        }
      }
    }

    // 3. Direct hit testing on strokes or existing items with tight 3px tolerance
    const hit = this.painter.hitTest(info.clientX, info.clientY, 3, {
      includeUnfilled: true,
      ignoreBackground: true,
    });

    if (hit) {
      const current = readStyle(hit.node);

      // If stroke was clicked: recolour outline
      if (hit.kind === "stroke") {
        applyStyle(hit.node, { stroke: fillColor });
        this.painter.invalidateBarrierCache();
        this.painter.commit();
        this.onPointerHover(info);
        return;
      }

      // If clicked inside an existing shape or fill region
      const tag = hit.node.tagName.toLowerCase();
      const isBrushRibbon =
        tag === "path" &&
        hit.node.getAttribute("fill-rule") === "nonzero" &&
        !current.stroke;

      // If it's a basic closed shape or an existing filled path
      if (!isBrushRibbon) {
        applyStyle(hit.node, { fill: fillColor });
        this.painter.invalidateBarrierCache();
        this.painter.commit();
        this.onPointerHover(info);
        return;
      }

      // If user clicked directly on the ribbon of a brush stroke, recolour that stroke
      applyStyle(hit.node, { fill: fillColor });
      this.painter.invalidateBarrierCache();
      this.painter.commit();
      this.onPointerHover(info);
      return;
    }

    // 4. Fallback region detection (e.g. if click was slightly on stroke edge near crevice)
    if (fillColor) {
      const filled = this.painter.fillEnclosedRegion(info.x, info.y);
      if (filled) {
        this.onPointerHover(info);
        return;
      }
    }

    // 5. Open canvas or un-enclosed click: do NOT fill entire canvas background
    this.painter.clearFillPreview();
  }

  onPointerMove(): void {}
  onPointerUp(): void {}

  onPointerHover(info: PointerInfo): void {
    if (info.altKey) {
      this.painter.clearFillPreview();
      const hit = this.painter.hitTest(info.clientX, info.clientY, 6, {
        includeUnfilled: true,
        ignoreBackground: false,
      });
      this.painter.setCursor(hit ? "pointer" : "crosshair");
      return;
    }

    const isInk = this.painter.isInkAt(info.x, info.y);

    // 1. If hover is on empty pixels (crevices, interiors), prioritize enclosed region preview
    if (!isInk) {
      const d = this.painter.detectEnclosedRegion(info.x, info.y);
      if (d) {
        this.painter.setCursor("pointer");
        this.painter.showFillPreview({ kind: "region", d });
        return;
      }
    }

    // 2. Stroke or item hover with tight 3px tolerance
    const hit = this.painter.hitTest(info.clientX, info.clientY, 3, {
      includeUnfilled: true,
      ignoreBackground: true,
    });

    if (hit) {
      this.painter.setCursor("pointer");
      if (hit.kind === "stroke") {
        this.painter.showFillPreview({ kind: "stroke", node: hit.node });
        return;
      }
      const tag = hit.node.tagName.toLowerCase();
      const current = readStyle(hit.node);
      const isBrushRibbon =
        tag === "path" &&
        hit.node.getAttribute("fill-rule") === "nonzero" &&
        !current.stroke;

      this.painter.showFillPreview({
        kind: isBrushRibbon ? "stroke" : "shape",
        node: hit.node,
      });
      return;
    }

    // 3. Fallback region preview (e.g. near crevice stroke boundary)
    const dFallback = this.painter.detectEnclosedRegion(info.x, info.y);
    if (dFallback) {
      this.painter.setCursor("pointer");
      this.painter.showFillPreview({ kind: "region", d: dFallback });
      return;
    }

    this.painter.setCursor("crosshair");
    this.painter.clearFillPreview();
  }
}
