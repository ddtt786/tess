// ============================================================================
//  @tess/player — 실행 서버. debug-ui.ts 는 타입만 벗겨 브라우저로 내보내는
//  파일이라 여기서 import 하지 않는다.
// ============================================================================
export { serveProject, findLocalRuntime, findPreactDir, DEFAULT_PORT } from "./src/server.ts";
export type { RunningServer, ServeOptions } from "./src/server.ts";
export type { AssetRoutes } from "./src/asset-routes.ts";
export type { PlayerPageOptions } from "./src/template.ts";
export { assetRoutes, withServedAssets } from "./src/asset-routes.ts";
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
