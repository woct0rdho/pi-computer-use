import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { noteAfterAct, noteFromLook } from "../src/note.ts";
import { countOutlineNodes, foldToBudget, graftScopedOutline, nodeByRef, parseLookResponse } from "../src/outline.ts";
import { shouldPreferForegroundModalWindow } from "../src/root-selection.ts";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const windowsMain = fs.readFileSync(path.join(root, "native/windows/bridge-rs/src/main.rs"), "utf8");
const ts = fs.readFileSync(path.join(root, "src/bridge.ts"), "utf8");
const noteTs = fs.readFileSync(path.join(root, "src/note.ts"), "utf8");
const configTs = fs.readFileSync(path.join(root, "src/config.ts"), "utf8");
const setupHelper = fs.readFileSync(path.join(root, "scripts/setup-helper.mjs"), "utf8");
const srcFiles = fs.readdirSync(path.join(root, "src"), { recursive: true })
	.filter((file) => typeof file === "string" && file.endsWith(".ts"))
	.map((file) => [file, fs.readFileSync(path.join(root, "src", file), "utf8")]);
const results = [];

function check(name, fn) {
	try {
		fn();
		results.push([name, true]);
		console.log(`PASS ${name}`);
	} catch (error) {
		results.push([name, false]);
		process.exitCode = 1;
		console.error(`FAIL ${name}: ${error.message}`);
	}
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

check("windows-only native UI surface", () => {
	for (const removed of ["native/macos", "native/linux", "src/platform/macos", "src/platform/linux", "prebuilt/macos", "prebuilt/linux", "src/cdp.ts", "src/platform/macos/browser.ts"]) {
		assert(!fs.existsSync(path.join(root, removed)), `${removed} still exists`);
	}
	const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
	assert(!JSON.stringify(pkg.files).includes("macos"), "package files still include macOS assets");
	assert(!JSON.stringify(pkg.files).includes("linux"), "package files still include Linux assets");
	assert(!JSON.stringify(pkg.scripts).toLowerCase().includes("linux"), "package scripts still reference Linux");
	for (const [file, text] of srcFiles) {
		assert(!/launch_browser|navigate_browser|evaluate_browser|CdpPageSnapshot|browser_page/.test(text), `browser-control surface appears in src/${file}`);
	}
});

check("INV-1 static helper observation commands removed", () => {
	assert(!windowsMain.includes("visionTargets"), "main.rs still contains visionTargets");
	assert(!windowsMain.includes("axSnapshotTree"), "main.rs still contains axSnapshotTree");
	assert(!/case\s+"screenshot"/.test(windowsMain), "helper still dispatches screenshot");
	assert(!/"look"\s*\|\s*"screenshot"/.test(windowsMain), "helper still aliases screenshot to look");
});

check("INV-1 static src lookCompat absent", () => {
	for (const [file, text] of srcFiles) {
		assert(!text.includes("lookCompat"), `lookCompat appears in src/${file}`);
	}
});

check("INV-2 static no TS coordinate transforms or capture dimensions", () => {
	for (const [file, text] of srcFiles) {
		assert(!/screenPointToCapturePoint|screenFrameToCaptureFrame/.test(text), `coordinate transform appears in src/${file}`);
		assert(!/\bcaptureWidth\b|\bcaptureHeight\b/.test(text), `capture dimensions appear in src/${file}`);
	}
});

check("INV-3 static scene fusion and auto-confirm absent", () => {
	for (const [file, text] of srcFiles) {
		assert(!/sceneAxTargetsFromSemantic|buildSceneProjection|autoConfirmButton|coordinateStateSignature/.test(text), `deleted scene/confirm helper appears in src/${file}`);
	}
});

check("INV-4 static act owns input command surface", () => {
	assert(srcFiles.some(([, text]) => /interface HelperActResult[\s\S]*outcome: ActOutcome/.test(text)), "TS helper act result does not carry outcome");
	for (const [file, text] of srcFiles) {
		assert(!/verifiedCoordinateClick|coordinateStateSignature/.test(text), `deleted verification helper appears in src/${file}`);
	}
	const deletedCommands = [
		"mouseClick", "mouseMove", "mouseDrag", "scrollWheel", "keyPress", "typeText", "setValue", "selectText",
		"axClickElement", "axPerformActionElement", "axFocusElement", "axFocusAtPoint", "axClickAtPoint",
		"axFindTextInput", "axFocusTextInput", "axPressElement", "axPressAtPoint",
	];
	for (const command of deletedCommands) {
		assert(!new RegExp(`case\\s+"${command}"`).test(windowsMain), `main.rs still dispatches ${command}`);
		assert(!new RegExp(`windowsHelper\\.command(?:<[^>]+>)?\\(\\s*["']${command}["']`).test(ts), `src still calls helper command ${command}`);
	}
});

check("INV-8 deleted architecture-v1 identifiers absent", () => {
	const deletedSrcIdentifiers = [
		"SceneProjection", "SceneTarget", "SceneEdge", "SceneAssociation", "buildSceneProjection",
		"sceneAssociationScore", "labelAssociationScore", "bestEdgesByVision", "clusterVisionUnknowns",
		"semanticSceneTarget", "visionSceneTarget", "searchSceneTargets", "sceneAxTargetsFromSemantic",
		"parseVisionTargets", "visionTargetByRef", "visionClickPoint", "formatVisionTargetLabel",
		"axCoordinateFallbackPoint", "screenPointToCapturePoint", "screenFrameToCaptureFrame",
		"frameCenter", "frameArea", "intersectionArea", "coordinateStateSignature",
		"verifiedCoordinateClick", "mouseClickAtCapturePoint", "autoConfirmButton", "refreshAxTargets",
		"axTreeRawForTarget", "semanticAxTree", "helperVisionTargets", "currentSemanticAxTargets",
		"currentVisionTargets", "currentScene", "lookCompat", "SceneToolDetails", "ScreenshotParams",
		"ScreenshotPayload", "performScreenshot", "coordinateVerification", "coordinateStateChanged",
	];
	for (const [file, text] of srcFiles) {
		for (const identifier of deletedSrcIdentifiers) {
			assert(!text.includes(identifier), `${identifier} appears in src/${file}`);
		}
	}
	const deletedNativeIdentifiers = ["visionTargets", "axSnapshotTree", "reacquireAxTarget"];
	for (const identifier of deletedNativeIdentifiers) {
		assert(!windowsMain.includes(identifier), `${identifier} appears in native/windows/bridge-rs/src/main.rs`);
	}
});

check("INV-5 listRoots seam stays platform-neutral", () => {
	assert(srcFiles.some(([, text]) => /interface PlatformRoot[\s\S]*isModal: boolean/.test(text)), "PlatformRoot lacks required isModal fact");
	assert(srcFiles.some(([, text]) => /interface PlatformRoot[\s\S]*metadata\?: Record<string, unknown>/.test(text)), "PlatformRoot lacks metadata escape hatch");
	assert(!srcFiles.some(([, text]) => /interface PlatformRoot[\s\S]*\bpairing:/.test(text)), "PlatformRoot must not require pairing");
	assert(!srcFiles.some(([, text]) => /interface PlatformRoot[\s\S]*\bsheetCount:/.test(text)), "PlatformRoot must not require sheetCount");
});

check("explicit root is not replaced by a modal window behind it", () => {
	const rootWindow = (overrides) => ({
		windowId: 1,
		windowRef: "w1",
		title: "Input",
		zOrder: 5,
		isModal: false,
		isFocused: false,
		isMain: true,
		isMinimized: false,
		isOnscreen: true,
		...overrides,
	});
	const current = rootWindow({});
	const behindModal = rootWindow({ windowId: 2, windowRef: "w2", title: "Main", zOrder: 20, isModal: true });
	const foregroundModal = rootWindow({ windowId: 3, windowRef: "w3", title: "Prompt", zOrder: 2, isModal: true });
	assert(!shouldPreferForegroundModalWindow(current, behindModal), "modal root behind the explicit target was promoted");
	assert(shouldPreferForegroundModalWindow(current, foregroundModal), "foreground modal root was not promoted");
});

function enclosingFunctionName(text, index) {
	const prefix = text.slice(0, index);
	const matches = [...prefix.matchAll(/(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/g)];
	return matches.at(-1)?.[1] ?? "(unknown)";
}

check("INV-6 static note is derived and disposable", () => {
	for (const match of noteTs.matchAll(/export\s+function\s+([A-Za-z0-9_]+)/g)) {
		assert(/^note|^render/.test(match[1]), `src/note.ts exports non-note/render function ${match[1]}`);
	}
	assert(!/export\s+(let|const|var)\s+/.test(noteTs), "src/note.ts exports mutable or module state");
	const allowed = new Set(["captureCurrentTarget", "runActionTool", "reconstructStateFromBranch", "shutdownComputerUseSession"]);
	for (const match of ts.matchAll(/runtimeState\.currentNote\s*=/g)) {
		const fn = enclosingFunctionName(ts, match.index ?? 0);
		assert(allowed.has(fn), `runtimeState.currentNote assigned in ${fn}`);
	}
});

check("INV-7 static no label-confirm press regex", () => {
	for (const [file, text] of srcFiles) {
		assert(!/\/[^/\n]*(confirm|ok|continue|apply)[^/\n]*\/[gimsuyd]*[\s\S]{0,200}(\bpress\b|AXPress|axPress|axPerformActionElement)/i.test(text), `confirm-label press regex appears in src/${file}`);
		assert(!/(confirm|ok|continue|apply)[\s\S]{0,80}(includes|startsWith|endsWith|===|==)[\s\S]{0,200}(\bpress\b|AXPress|axPress|axPerformActionElement)/i.test(text), `confirm-label press comparison appears in src/${file}`);
	}
});

check("INV-8 tsc no unused locals", () => {
	execFileSync(process.execPath, [path.join(root, "node_modules", "typescript", "bin", "tsc"), "--noEmit"], { cwd: root, stdio: "pipe" });
});

check("INV-9 immutable state ownership", () => {
	const state = fs.readFileSync(path.join(root, "src/state.ts"), "utf8");
	assert(!/runtimeState\.current(Target|Capture|Look|Outline|Note|ImageMode|StateTarget)/.test(ts), "global current UI state remains in bridge");
	assert(state.includes("class SavedStates") && state.includes("new StateStore<UiObservation>"), "unified bounded observation store is missing");
});

check("INV-10 resource-keyed scheduling", () => {
	assert(ts.includes("desktopResourceKey") && ts.includes("resourceScheduler.write"), "desktop writes are not resource scheduled");
	assert(!ts.includes("withRuntimeLock"), "global runtime lock remains");
});

check("INV-11 unified agent contract", () => {
	const extension = fs.readFileSync(path.join(root, "extensions/computer-use.ts"), "utf8");
	const tools = [...extension.matchAll(/defineTool\(\{\s*name:\s*"([^"]+)"/g)].map((match) => match[1]);
	const expected = ["find_roots", "observe_ui", "search_ui", "expand_ui", "inspect_ui", "act_ui", "read_text", "wait_for"];
	assert(JSON.stringify(tools) === JSON.stringify(expected), `unexpected public tool surface: ${tools.join(", ")}`);
	assert(!extension.includes('executionMode: "sequential"'), "computer-use tools remain globally sequential");
	assert(extension.includes("Required state id owning every @e ref"), "state-scoped ref contract is missing");
});

check("INV-12 parallel native transports", () => {
	assert(windowsMain.includes("thread::spawn") && windowsMain.includes("physical_input_lock"), "Windows helper is not concurrent with protected physical input");
	assert(windowsMain.includes("REQUEST_WORKERS"), "Windows helper does not use a fixed worker pool");
});

check("INV-14 native batches settle once", () => {
	assert(ts.includes("currentPlatformBackend.actBatch") && ts.includes("dispatchUiTransaction"), "bridge does not route batches through the native transaction seam");
	assert(windowsMain.includes('"actBatch" => handle_act_batch') && windowsMain.includes("deferRootDelta"), "Windows helper does not defer per-step root deltas");
	assert(windowsMain.includes('response["stoppedAt"]'), "native batches do not report their checked stop boundary");
});

check("INV-15 semantic action postconditions", () => {
	const extension = fs.readFileSync(path.join(root, "extensions/computer-use.ts"), "utf8");
	const actions = fs.readFileSync(path.join(root, "src/actions.ts"), "utf8");
	assert(extension.includes("expect: Type.Optional") && extension.includes("timeoutMs"), "act_ui does not expose a semantic postcondition");
	assert(ts.includes('code: "postcondition_failed"') && ts.includes('status: "verified" | "preexisting" | "failed"'), "postcondition failure is not represented honestly");
	assert(ts.includes("outcomeAfterCheck") && actions.includes('check === "verified"') && actions.includes('return "worked"'), "newly verified expectations do not determine the request outcome");
	assert(windowsMain.includes("await_delta_snapshot") && windowsMain.includes("root_events_since"), "Windows waits are not change-notification assisted");
});

check("INV-16 clean headless contract and non-destructive helper install", () => {
	assert(!/stealth_mode|stealthMode|PI_COMPUTER_USE_STEALTH|PI_COMPUTER_USE_STRICT_AX/.test(configTs), "obsolete stealth configuration aliases remain");
	assert(!/tccutil|codesign|xcrun|swiftc/.test(setupHelper), "helper installation contains removed platform tooling");
	assert(setupHelper.includes("PI_COMPUTER_USE_WINDOWS_HELPER_PATH"), "helper installer lacks an isolated test destination");
	assert(setupHelper.includes("windows-bridge.exe"), "helper installer does not install the Windows helper");
});

check("INV-18 consolidated actions and diff-first resulting views", () => {
	const actions = fs.readFileSync(path.join(root, "src/actions.ts"), "utf8");
	const view = fs.readFileSync(path.join(root, "src/view.ts"), "utf8");
	const windowsBackend = fs.readFileSync(path.join(root, "src/platform/windows/backend.ts"), "utf8");
	const extension = fs.readFileSync(path.join(root, "extensions/computer-use.ts"), "utf8");
	assert(actions.includes("prepareAction") && actions.includes("canRetryInForeground"), "action preparation and safe recovery are not consolidated");
	assert(!fs.existsSync(path.join(root, "src/interaction.ts")), "superseded interaction policy module still exists");
	assert(!ts.includes("responseMode") && !extension.includes("responseMode"), "alternate confirmation-only action path still exists");
	assert(ts.includes("currentFocus") && ts.includes('escalationReason = "side_effect_free_didnt"'), "runner does not preserve action focus or recover checked keyboard failures");
	assert(view.includes("stabilizeRefs") && view.includes("changesBetween"), "resulting-state ref stabilization or change rendering is missing");
	assert(ts.includes('view: "full" | "diff"') && ts.includes("Changes ("), "agent result does not expose changes-first resulting views");
	assert(extension.includes("const uiAction = Type.Union") && extension.includes("omit ref from typeText"), "agent action schema is not discriminated or focus-aware");
	assert(!ts.includes("preserveFocus") && windowsBackend.includes("preserveFocus") && windowsMain.includes("!preserve_focus"), "native focus continuity leaks through the coordinator or is not enforced by the backend");
});

check("INV-20 bounded broad root discovery", () => {
	assert(ts.includes("async function windowDetailsForFind"), "find_roots lacks an explicit root-acquisition boundary");
	assert(/if \(!query\.app && !Number\.isFinite\(query\.pid\)\)[\s\S]{0,160}listRoots\(\{\}, signal\)/.test(ts), "broad find_roots does not use one platform listRoots call");
	assert(ts.includes("return await collectWindowDetails(apps, signal)"), "filtered find_roots does not retain per-app discovery");
	assert(windowsMain.includes("fn handle_list_roots"), "Windows helper lacks root discovery");
});

if (results.some(([, ok]) => !ok)) process.exit(1);
