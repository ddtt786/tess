// ============================================================================
//  실행 페이지의 전역 — entryjs 실행기와 tess 가 심어 두는 다리
//
//  entryjs ships no types, and the debug panel only ever pokes at it
//  defensively (every call is guarded or wrapped in try/catch), so the runtime
//  is declared as an opaque object rather than modelled member by member. The
//  `tess*` hooks are ours: the page installs stubs, the panel replaces them,
//  and the two call each other through this surface.
// ============================================================================

/** The entryjs runtime, as the debug panel finds it on the page. */
interface EntryRuntime {
  block?: Record<string, any>;
  container?: any;
  engine?: any;
  options?: any;
  scene?: any;
  stage?: any;
  variableContainer?: any;
  requestUpdate?: boolean;
  requestUpdateTwice?: boolean;
  [key: string]: any;
}

/** One line the page forwarded for the panel's error tab. */
interface TessLogItem {
  kind: string;
  message: string;
  stack?: string;
  time: number;
}

declare global {
  /** entryjs installs itself as a bare global; the panel reads it after a guard. */
  const Entry: EntryRuntime;

  /** preact's `h`, imported from the url the player server serves it at. */
  const h: (type: any, props: any, ...children: any[]) => any;
  /** preact's `render`, imported from that same url. */
  const render: (vnode: any, parent: Element) => void;

  interface Window {
    Entry?: EntryRuntime;
    EntryPaint?: any;
    EntrySoundEditor?: any;
    createjs?: any;

    /** Block id -> source position, set by the player page before the panel loads. */
    tessSourceMap?: Record<string, any>;

    // --- installed by the page, called by the panel ------------------------
    /** Hands the panel the log sink; replays whatever arrived before it was ready. */
    tessDebugSink(receive: (item: TessLogItem) => void): void;
    /** Reports a runtime failure into the panel's error tab. */
    tessReportError(kind: string, error: unknown): void;

    // --- installed by the panel, called by the page ------------------------
    /** Wraps the environment blocks so the panel can force their answers. */
    tessPatchEnvironmentBlocks(): void;
    /** Draws the panel from a freshly loaded project.json. */
    tessRenderProjectDebug(project: any): void;
    /** Starts watching for Ctrl+Shift picks on the stage. */
    tessWatchStagePicks(): void;
    /** Re-measures the stage after the panel's width changes. */
    tessLayoutCanvas(): void;
    /** Opens the panel on the object owning this block and highlights it. */
    tessHighlightBlock(blockId: string): void;
    /** Selects one object in the panel, as a stage pick does. */
    tessSelectObjectById(id: string): void;
    /** Every block by id, for the page to look one up. */
    tessBlockDataById: Map<string, any>;
    /** This block's id plus the ids of the blocks plugged into it. */
    tessCollectParamIds(node: any, out?: string[]): string[];
    /**
     * Turns entry's bare "can not insert value to array" into a message naming
     * the list and its length, or null when the error is a different one.
     */
    tessDescribeListIndexError(reportedBlockId: string, error: any): string | null;
  }
}

export {};
