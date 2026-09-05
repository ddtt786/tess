/**
 * @fileoverview @tess/player 패키지 진입점
 * 
 * 컴파일된 Tess 작품을 브라우저에서 실행하고 테스트할 수 있는 로컬 서버 모듈입니다.
 * 
 * @note `debug-ui.ts` 파일은 클라이언트 사이드에서 사용하기 위해 타입만 제거한 후 브라우저로 제공되므로, 여기서는 임포트하지 않습니다.
 */
export { serveProject, findLocalRuntime, findPreactDir, debugUiSource, DEFAULT_PORT } from "./src/server.ts";
export type { RunningServer, ServeOptions } from "./src/server.ts";
export type { AssetRoutes } from "./src/asset-routes.ts";
export type { PlayerPageOptions } from "./src/template.ts";
export { assetRoutes, withServedAssets } from "./src/asset-routes.ts";
export { DEBUG_PANEL_STYLE } from "./src/debug-style.ts";
export {
  playerPage,
  THIRD_PARTY_SCRIPTS,
  THIRD_PARTY_STYLE,
  ENTRY_FONT_STYLES,
  RUNTIME_FILES,
  RUNTIME_STYLE,
  DEBUG_UI_PATH,
  PREACT_PATH,
} from "./src/template.ts";
