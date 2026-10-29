import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const extension = read("extensions/computer-use.ts");
const bridge = read("src/bridge.ts");
const contract = read("src/contract.ts");
const actions = read("src/actions.ts");
const view = read("src/view.ts");
const windowsBackend = read("src/platform/windows/backend.ts");
const windowsMain = read("native/windows/bridge-rs/src/main.rs");
const setupHelper = read("scripts/setup-helper.mjs");

function check(name, fn) {
    try {
        fn();
        console.log(`PASS ${name}`);
    } catch (error) {
        console.error(`FAIL ${name}: ${error.message}`);
        process.exitCode = 1;
    }
}

check("Windows-only, general UI", () => {
    for (const removed of ["native/macos", "native/linux", "src/platform/macos", "src/platform/linux", "prebuilt/macos", "prebuilt/linux", "src/cdp.ts"]) {
        assert(!fs.existsSync(path.join(root, removed)), `${removed} still exists`);
    }
    for (const file of ["src/bridge.ts", "src/contract.ts", "extensions/computer-use.ts"]) {
        assert(!/launch_browser|navigate_browser|evaluate_browser|CdpPageSnapshot|browser_page/.test(read(file)), `browser-control surface appears in ${file}`);
    }
});

check("five-tool public surface", () => {
    const tools = [...extension.matchAll(/defineTool\(\{\s*name:\s*"([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(tools, ["list_apps", "get_window_state", "act", "wait_for", "launch_app"]);
    for (const name of tools) assert(extension.includes(`name: "${name}"`), `${name} missing`);
    assert(extension.includes("outputSchema:"), "tools must declare output schemas for codemode");
    assert(extension.includes("screenshotData"), "get_window_state must expose screenshot data for codemode image()");
    assert(!/reimplement|node_repl|createCodemode/i.test(extension), "extension must not implement a custom REPL");
});

check("legacy public surface removed", () => {
    assert(!fs.existsSync(path.join(root, "src/note.ts")), "note.ts should be removed");
    assert(!fs.existsSync(path.join(root, "src/root-selection.ts")), "root-selection.ts should be removed");
    for (const legacy of ["find_roots", "observe_ui", "search_ui", "expand_ui", "inspect_ui", "act_ui", "read_text", "@o"]) {
        assert(!extension.includes(legacy), `legacy surface ${legacy} remains in extension`);
        assert(!bridge.includes(`"${legacy}"`), `legacy surface ${legacy} remains in bridge`);
    }
    assert(!bridge.includes("reconstructStateFromBranch"), "branch reconstruction should be removed");
    assert(!bridge.includes("currentNote"), "running note state should be removed");
});

check("state-scoped successor contract", () => {
    assert(contract.includes("stateId: string") && contract.includes("WindowStateResult"), "state contract missing");
    assert(bridge.includes("withWindowWriteLock") && bridge.includes("resourceScheduler.write"), "mutations are not resource scheduled");
    assert(bridge.includes("changesBetween") && bridge.includes("stabilizeRefs"), "successor diff/ref stabilization missing");
    assert(view.includes("changesBetween") && view.includes("stabilizeRefs"), "view layer lost diff/ref stabilization");
    assert(!/runtimeState\.current(Target|Capture|Look|Outline)/.test(bridge), "global current UI state remains");
});

check("action engine is consolidated", () => {
    assert(actions.includes("EngineAction") && actions.includes("prepareAction") && actions.includes("canRetryInForeground"), "action engine missing");
    assert(actions.includes("parseKeyChord"), "key chord parser missing");
    assert(bridge.includes("prepareUiTransaction") && bridge.includes("dispatchUiTransaction") && bridge.includes("actBatch"), "native transaction seam missing");
    assert(contract.includes("nextWindows"), "act successor windows missing");
    assert(extension.includes("includeScreenshot"), "act screenshot control missing");
    assert(bridge.includes("executeAct") && bridge.includes("outcomeAfterObservedValues"), "act result reconciliation missing");
    assert(extension.includes("Type.Union([clickAction"), "act action schema is not discriminated");
});

check("native Windows mechanisms remain", () => {
    assert(windowsMain.includes("thread::spawn") && windowsMain.includes("physical_input_lock") && windowsMain.includes("REQUEST_WORKERS"), "concurrent helper/input lock missing");
    assert(windowsMain.includes('"actBatch" => handle_act_batch') && windowsMain.includes('response["stoppedAt"]'), "native transaction support missing");
    assert(windowsMain.includes('"launchApp" => handle_launch_app') && windowsMain.includes("ShellExecuteExW"), "native launchApp missing");
    assert(windowsBackend.includes("launchApp"), "Windows backend launchApp missing");
    assert(setupHelper.includes("PI_COMPUTER_USE_WINDOWS_HELPER_PATH") && setupHelper.includes("windows-bridge.exe"), "helper install contract missing");
});

check("explicit coordinate/accessibility contract", () => {
    assert(contract.includes("elementIndex") && contract.includes("screenshotId"), "element/screenshot binding missing");
    assert(contract.includes("includeScreenshot") && contract.includes("screenshotData"), "screenshot controls missing");
    assert(contract.includes("includeText"), "text control missing");
    assert(bridge.includes("ensurePointIsInLookImage"), "coordinate validation missing");
    assert(bridge.includes("windowMatchesTarget"), "window/state binding validation missing");
    assert(bridge.includes("isListableRoot"), "shell/ghost window filtering missing");
    assert(contract.includes("window?: WindowRef") && extension.includes("window: Type.Optional(windowRef)"), "state-scoped window should be optional");
});

check("bounded model-facing output", () => {
    const output = read("src/output.ts");
    assert(output.includes("MODEL_TEXT_MAX_BYTES") && output.includes("applyOutputEnvelope"), "bounded output envelope missing");
    assert(!bridge.includes("serializeOutline(refreshed.outline)"), "full serialized outline leaked into tool details");
    assert(!bridge.includes("@o"), "output continuation refs should be removed");
});

if (process.exitCode) process.exit(1);
console.log("Invariant checks passed.");
