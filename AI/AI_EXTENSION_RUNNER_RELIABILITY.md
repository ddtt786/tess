# Runner replacement and built-in saves

## Frame ownership

`content.ts` tracks the frame, its original URL, its host and its anchor together.
The previous `data-tessvm-held` early return ignored subsequent `src` assignments.
A site rerender could therefore restart the original iframe while the replacement
player remained present. Parent-wide host lookup also reused a stale project's
host when the site replaced the iframe node.

The content script recaptures repeated URL assignments, remounts changed project
IDs, removes detached hosts, and restores a detached frame's original URL so that
reinsertion remains recognizable. It observes the document before the root element
exists. A settings-read failure uses the default enabled state rather than leaving
captured frames without a host.

The page module observes host insertion, removal and settings attributes directly.
It disposes removed players and mounts new hosts without depending on scan/unmount
window-message ordering. Rendering mutations inside a player do not rescan the page.

## Save function bodies

The project `6a8eaeb776461c96f3387684` defines a save function whose body broadcasts
the project's saved-status message. Both decompilation and VM code generation
previously treated save functions as empty hooks and discarded that body.

The decompiler now keeps a function with authored statements and inserts the save
operation before those statements. Empty save hooks retain the compact `save`
representation. Direct VM compilation likewise runs the save hook before the
original function body. The synchronous save waits for storage before continuing.

Storage remains extension-owned IndexedDB. The extension boot path supplies its
own save host unconditionally; no other add-on installation is required. Content
and page scripts no longer modify another extension's globals or notification DOM.

## Preparation errors

The player handles failures across its entire asynchronous preparation path,
including cloud-client construction and connection. A preparation exception clears
the loading label and displays its error. A player disposed while connecting does
not proceed to create another VM.

## Firefox host permissions

In Manifest V3, Firefox enforces host permission management for declarative `content_scripts`.
When `manifest.json` specifies `content_scripts.matches` without corresponding `host_permissions`,
Chrome auto-grants permission on installation, but Firefox withholds site access by default
("Only When Clicked"). As a result, content scripts are withheld and do not inject on page load
until the user manually interacts with the toolbar action button.

Declaring `host_permissions: ["https://playentry.org/*"]` ensures Firefox prompts for and grants
the host permission upon installation, allowing `content.js` to execute at `document_start`
without requiring user interaction with the extension icon. `build.ts` asserts that all
`content_scripts` match patterns exist in `host_permissions`.

## Verification

- Six frame-lifecycle regressions and the authored save-body regression fail on
  commit `4d2ad71` and pass with these changes.
- The related storage, player and lifecycle suite passes all 33 tests.
- Extension manifest verification asserts host permissions covering content script matches.
- The full suite run reports 2,708 passes and one existing failure in
  `test/painter.test.ts`, whose imports do not match the painter package exports.
  The subsequent preparation-error regression also passes.
- Extension, VM and player browser TypeScript checks pass. Root TypeScript reports
  only the existing painter test errors.
- Chrome and Firefox integration checks use separate temporary profiles containing
  only this extension, and load the actual public project page. They start the real
  player, enter the in-game scene, invoke the project's scene-start save path, and
  verify eleven stored names. A changed gold value of 12,345 survives a page reload.
- The popup lists the stored project. Reassigning the original iframe URL leaves
  one player and one host, with the original iframe recaptured as `about:blank`.

The integration check exercises the supplied project's save path and reload; it
does not claim a complete playthrough or universal coverage of every project.
Chrome ZIP, Firefox ZIP and CRX artifacts are built by the repository build script.
