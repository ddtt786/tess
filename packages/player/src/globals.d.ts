/**
 * 실행 페이지의 전역 스코프에 선언되는 타입들입니다.
 * 
 * 엔트리 실행기(entryjs)와 Tess 디버그 패널 간의 브리지 역할을 합니다.
 * `entryjs`는 타입 정보 없이 전역 객체로 삽입되며, 디버그 패널은 이를 방어적으로 호출합니다.
 * `tess*`로 시작하는 훅들은 실행 페이지가 주입하고 디버그 패널이 사용하거나, 그 반대로 동작하기 위해 정의된 통신 규약입니다.
 */

/** 
 * 디버그 패널이 실행 페이지에서 접근할 수 있는 `entryjs` 런타임 객체입니다. 
 *
 * @example
 * ```typescript
 * const currentState = Entry.engine.isState('run');
 * ```
 */
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

/** 
 * 디버그 패널의 오류 탭에 표시하기 위해 실행 페이지가 전달하는 로그 항목입니다. 
 *
 * @example
 * ```typescript
 * const log: TessLogItem = { kind: '실행 오류', message: '변수를 찾을 수 없습니다.', time: Date.now() };
 * ```
 */
interface TessLogItem {
  kind: string;
  message: string;
  stack?: string;
  time: number;
}

declare global {
  /** 
   * `entryjs`가 전역으로 설치한 객체입니다. 디버그 패널은 존재 여부를 확인한 후 접근해야 합니다. 
   *
   * @example
   * ```typescript
   * if (window.Entry) { console.log(Entry.options); }
   * ```
   */
  const Entry: EntryRuntime;

  /** 
   * 플레이어 서버가 제공하는 경로에서 가져온 Preact의 `h` 함수입니다. 
   *
   * @example
   * ```typescript
   * const element = h('div', { class: 'box' }, 'Hello');
   * ```
   */
  const h: (type: any, props: any, ...children: any[]) => any;
  /** 
   * 플레이어 서버가 제공하는 경로에서 가져온 Preact의 `render` 함수입니다. 
   *
   * @example
   * ```typescript
   * render(h(App, null), document.body);
   * ```
   */
  const render: (vnode: any, parent: Element) => void;

  interface Window {
    Entry?: EntryRuntime;
    EntryPaint?: any;
    EntrySoundEditor?: any;
    createjs?: any;

    /** 
     * 디버그 패널이 로드되기 전에 플레이어 페이지가 설정하는, 블록 ID와 소스 맵 정보입니다. 
     *
     * @example
     * ```typescript
     * const sourcePos = window.tessSourceMap['block123'];
     * ```
     */
    tessSourceMap?: Record<string, any>;

    /**
     * 디버그 패널이 실행기를 만나는 유일한 통로입니다. 없으면 패널은 엔트리
     * 실행기(`window.Entry`)에 붙습니다. tessvm 은 패널을 불러오기 전에 자기
     * 어댑터를 여기 걸어 둡니다 (`packages/tessvm/src/web/debug.ts`).
     *
     * @example
     * ```typescript
     * window.tessRuntime = makeVmRuntime(handle);
     * ```
     */
    tessRuntime?: any;

    // --- 실행 페이지가 설치하고 디버그 패널이 호출하는 함수들 ------------------------
    /** 
     * 디버그 패널에 로그를 수신할 콜백을 전달합니다. 패널이 준비되기 전 도착한 로그들을 다시 재생해 줍니다. 
     *
     * @param receive 로그 항목을 처리할 콜백 함수
     * @example
     * ```typescript
     * window.tessDebugSink((item) => console.log(item.message));
     * ```
     */
    tessDebugSink(receive: (item: TessLogItem) => void): void;
    /** 
     * 디버그 패널의 오류 탭에 런타임 오류를 보고합니다. 
     *
     * @param kind 오류 종류
     * @param error 발생한 예외 객체
     * @example
     * ```typescript
     * window.tessReportError('로딩 실패', new Error('파일을 찾을 수 없습니다.'));
     * ```
     */
    tessReportError(kind: string, error: unknown): void;

    // --- 디버그 패널이 설치하고 실행 페이지가 호출하는 함수들 ------------------------
    /** 
     * 환경 판단 블록들이 디버그 패널에서 설정한 값을 반환하도록 내부 함수를 감쌉니다. 
     *
     * @example
     * ```typescript
     * window.tessPatchEnvironmentBlocks();
     * ```
     */
    tessPatchEnvironmentBlocks(): void;
    /** 
     * 방금 로드된 `project.json`을 사용하여 디버그 패널을 렌더링합니다. 
     *
     * @param project 엔트리 작품 데이터
     * @example
     * ```typescript
     * window.tessRenderProjectDebug(projectData);
     * ```
     */
    tessRenderProjectDebug(project: any): void;
    /** 
     * 고르기 도구가 무대의 마우스 움직임과 클릭을 볼 수 있게 감지를 시작합니다. 
     *
     * @example
     * ```typescript
     * window.tessWatchStagePicks();
     * ```
     */
    tessWatchStagePicks(): void;
    /** 
     * 디버그 패널의 폭이 변경된 후 캔버스의 크기를 다시 계산하여 배치합니다. 
     *
     * @example
     * ```typescript
     * window.tessLayoutCanvas();
     * ```
     */
    tessLayoutCanvas(): void;
    /** 
     * 특정 블록을 소유한 오브젝트를 디버그 패널에서 열고 해당 블록을 강조 표시합니다. 
     *
     * @param blockId 강조할 블록의 ID
     * @example
     * ```typescript
     * window.tessHighlightBlock('block_42');
     * ```
     */
    tessHighlightBlock(blockId: string): void;
    /** 
     * 무대에서 오브젝트를 선택했을 때처럼, 디버그 패널에서 특정 오브젝트를 선택 상태로 만듭니다. 
     *
     * @param id 선택할 오브젝트의 ID
     * @example
     * ```typescript
     * window.tessSelectObjectById('object_1');
     * ```
     */
    tessSelectObjectById(id: string): void;
    /** 
     * 실행 페이지가 블록을 찾을 수 있도록, ID를 키로 하여 모든 블록 데이터를 담아둔 맵입니다. 
     *
     * @example
     * ```typescript
     * const block = window.tessBlockDataById.get('block_42');
     * ```
     */
    tessBlockDataById: Map<string, any>;
    /** 
     * 이 블록의 ID와 이 블록에 연결된 모든 파라미터 블록들의 ID를 재귀적으로 수집합니다. 
     *
     * @param node 수집을 시작할 블록 노드
     * @param out ID를 담을 배열 (선택 사항)
     * @returns 수집된 블록 ID 목록
     *
     * @example
     * ```typescript
     * const ids = window.tessCollectParamIds(myBlock);
     * ```
     */
    tessCollectParamIds(node: any, out?: string[]): string[];
    /**
     * 엔트리의 모호한 "배열에 값을 추가할 수 없습니다" 오류를 리스트 이름과 길이를 포함한 친절한 메시지로 변환합니다. 다른 오류인 경우 `null`을 반환합니다.
     *
     * @param reportedBlockId 오류가 발생한 블록의 ID
     * @param error 원본 오류 객체
     * @returns 변환된 메시지 또는 `null`
     *
     * @example
     * ```typescript
     * const msg = window.tessDescribeListIndexError('block_1', err);
     * if (msg) console.log(msg);
     * ```
     */
    tessDescribeListIndexError(reportedBlockId: string, error: any): string | null;
  }
}

export {};
