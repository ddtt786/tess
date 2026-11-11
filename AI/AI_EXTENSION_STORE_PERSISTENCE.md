# AI Extension Store Persistence & Save Pipeline Architecture

## 1. Overview & Problem Definition

In Entry and Tess environments, user projects persist game and application state using dedicated `store` variables and save function triggers (`@저장`, `@비동기저장`).
When executed via the Chrome and Firefox extension runner (`packages/extension`), saved values are intended to bridge across iframe boundaries to the background service worker and be stored into IndexedDB (`tessvm-save-db`).

### Symptoms Observed
- User projects executed within the extension called save functions, but values failed to persist.
- Opening the extension popup displayed: `"작품이 저장한 값이 아직 없습니다."` (`#saves-empty`).

---

## 2. Root Cause Analysis

### 2.1 Function Label Whitespace and Parameter Variations
- **Issue**: Authors frequently name Entry functions with trailing whitespace, leading whitespace, or function call parentheses (e.g. `@저장 `, ` @저장`, `@저장()`, `@저장 ()`).
- **Mechanism**: The compiler and decompiler previously performed an exact string match `name === '@저장'`. When trailing spaces or parentheses were present:
  1. The decompiler treated `@저장 ` as an ordinary custom function without binding to the runtime store saver.
  2. The compiler and kernel optimizer (`plan.ts`) marked the empty function block as dead code / no-op and stripped it out.
  3. Consequently, executing the block never invoked `O.saveStoreWait()` or `O.saveStore()`.

### 2.2 `SaveStore.used` State Dropping Write Operations
- **Issue**: In `packages/tessvm/src/runtime/save.ts`, `SaveStore.bind()` initialized `this.used = this.kept.length > 0 || this.flag !== null;`.
- **Mechanism**:
  - In projects where save functions were called or variables had non-standard `@` identifiers without an explicit `@확장프로그램` flag or pre-registered `@` list in `kept`, `this.used` remained `false`.
  - Inside `SaveStore.write()`:
    ```typescript
    if (!this.host || !this.used) return;
    ```
  - When `this.used` was `false`, `SaveStore.write()` silently aborted without invoking `host.write(payload)`.

### 2.3 Variable Normalization & Name Collisions
- **Issue**: In `packages/decompiler/src/index.ts`, extracting the name for `@` variables via `source.name.slice(STORE_PREFIX.length)` failed if there was a leading space (e.g. `' @점수'`), leaving the `@` intact and resulting in duplicate prefixes (`@@점수`).
- **Mechanism**:
  - In `decompiler/src/index.ts`: `name.trim().replace(/^@\s*/, '')` ensures that all whitespace variants are cleanly stripped when declaring `store` variables in Tess source.
  - In `runtime/save.ts`: `apply()` now uses a fallback `this.values[name] ?? this.values[name.trim()]` to preserve backward-compatible mapping.

### 2.4 Bridge Cross-Origin Communication in Sandboxed Frames
- **Issue**: In `packages/extension/src/page/save-bridge.ts` and `content.ts`, `postMessage` targeted `location.origin`. In sandboxed iframes (e.g. `origin === 'null'`), messages were dropped.
- **Mechanism**: `const targetOrigin = location.origin === 'null' ? '*' : location.origin;` ensures reliable transport across sandbox states.

### 2.5 Popup UI Focus Refresh
- **Issue**: Extension popup only called `paintSaves()` on initial script execution.
- **Mechanism**: Added `window.addEventListener('focus', () => void paintSaves())` with `typeof window !== 'undefined'` guard so returning to the popup re-queries IndexedDB and hides `#saves-empty`.

---

## 3. Implementation Details

### 3.1 Normalization Functions (`packages/core/src/save-manager.ts`)
```typescript
export function saveFunctionKind(name: string): 'wait' | 'async' | undefined {
  const norm = String(name ?? '')
    .trim()
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s+/g, '');
  if (norm === '@저장') return 'wait';
  if (norm === '@비동기저장') return 'async';
  return undefined;
}

export function isStoreFlag(name: string): boolean {
  const norm = String(name ?? '')
    .trim()
    .replace(/\s+/g, '');
  return norm === '@확장프로그램';
}

export function isStoreName(name: string): boolean {
  const trimmed = String(name ?? '').trim();
  return trimmed.startsWith(STORE_PREFIX) && !isStoreFlag(trimmed);
}
```

### 3.2 TessVM Codegen and Kernel Planning
- `packages/tessvm/src/kernel/plan.ts`: Prevents stripping save functions whose normalized kind is non-undefined:
  ```typescript
  if (saveFunctionKind(functionLabel(fn.content)) !== undefined) return false;
  ```
- `packages/tessvm/src/compile/codegen.ts`: Dispatches normalized function labels to `saveStoreWait()` or `saveStore()`.

### 3.3 Runtime SaveStore Write Guarantee
- `packages/tessvm/src/runtime/save.ts`:
  ```typescript
  bind(functions: readonly FunctionItem[] = []): void {
    const hasSaveFunction = functions.some(
      (fn) => saveFunctionKind(functionLabel(fn.content)) !== undefined,
    );
    this.used = this.kept.length > 0 || this.flag !== null || hasSaveFunction;
  }

  write(): void {
    if (!this.host) return;
    this.used = true;
    this.host.write({ ... });
  }
  ```

---

## 4. Verification Suite

The fix is validated across unit, runtime, compiler, decompiler, and extension integration tests:
1. `test/store.test.ts`: 20 unit tests verifying whitespace, parenthesis stripping, empty variable store triggers, and sync/async save semantics.
2. `test/extension-save.test.ts`: End-to-end integration test verifying message passing from VM runner through save-bridge and content script into background IndexedDB storage.
3. `test/extension-popup.test.ts`: UI rendering tests verifying `#saves-empty` visibility toggles, focus event listeners, and clear/import/export routines.
4. `test/extension-lifecycle.test.ts`: Frame lifecycle, duplicate runner prevention, and multi-iframe host permission checks.
