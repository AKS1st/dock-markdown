//#region src/index.ts
/**
* Host half of dock-markdown: deliberately minimal. File reading is
* delegated to dock-editor's /desk-editor/fs.read route (the markdown view
* fetches through it, same-origin), so no route handlers are registered
* here. inject stays identical to dock-editor so this plugin mounts in the
* same activation order and never applies before the web runtime is ready.
*/
const name = "dock-markdown";
/** Services required before mounting (same as dock-editor; no routes used). */
const inject = [
	"webServer",
	"sessions",
	"webRuntime"
];
/** No-op host body: all behavior lives in the client half. */
function apply() {}
//#endregion
export { apply, inject, name };
