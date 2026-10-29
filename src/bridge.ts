import { randomUUID } from "node:crypto";
import type { AgentToolResult, AgentToolUpdateCallback, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
    canRetryInForeground,
    outcomeAfterCheck,
    outcomeAfterObservedValues,
    prepareAction,
    type ActionState,
    type EngineAction,
    type PreparedAction,
} from "./actions.ts";
import { getComputerUseConfig, isHeadlessMode, loadComputerUseConfig } from "./config.ts";
import {
    elementIndexForNode,
    foldToBudget,
    nodeByElementIndex,
    nodeByRef,
    outlineNodeLabel,
    outlineRefIndex,
    renderOutlineSubtree,
    searchOutline,
    searchOutlineRanked,
    type FoldResult,
    type LookResponse,
    type Outline,
    type OutlineChange,
    type OutlineNode,
} from "./outline.ts";
import { applyOutputEnvelope, boundToolError, structuredContentFromDetails } from "./output.ts";
import {
    type ActParams,
    type ActResult,
    type AccessibilityView,
    type Change,
    type GetWindowStateParams,
    type LaunchAppParams,
    type LaunchAppResult,
    type ListAppsParams,
    type ListAppsResult,
    type ScreenshotView,
    type Verification,
    type WaitForParams,
    type WaitForResult,
    type WindowDetails,
    type WindowRef,
    type WindowStateResult,
} from "./contract.ts";
import { currentPlatformBackend } from "./platform/index.ts";
import type { FramePoints, HelperActResult, PlatformActRequest, PlatformRoot } from "./platform/types.ts";
import { ResourceScheduler } from "./runtime.ts";
import { SavedStates, type CurrentCapture, type CurrentTarget, type OperationState } from "./state.ts";
import { changesBetween, renderChanges, stabilizeRefs } from "./view.ts";

type ExecutionVariant = "stealth" | "default";
type ActionDelivery = "ax" | "hid";
type DeliveryPolicy = "ax_only" | "background" | "default" | "foreground";
type ActOutcome = "worked" | "didnt" | "unknown";

interface ExecutionTrace {
    strategy: "look" | "act" | "wait";
    runtimeMode?: ExecutionVariant;
    delivery?: ActionDelivery;
    deliveryPolicy?: DeliveryPolicy;
    outcome?: ActOutcome;
    verification?: Verification;
    error?: { code?: string; message?: string };
    rootDelta?: HelperActResult["rootDelta"];
    steps?: ExecutionTrace[];
    actionCount?: number;
    stoppedAt?: number;
    backgroundFirst?: boolean;
    escalatedToForeground?: boolean;
    escalationReason?: string;
}

interface ResolvedTarget extends CurrentTarget {
    framePoints: FramePoints;
    scaleFactor: number;
    isMinimized: boolean;
    isOnscreen: boolean;
    isFocused: boolean;
}

interface CaptureResult {
    target: ResolvedTarget;
    capture: CurrentCapture;
    look: LookResponse;
    outline: Outline;
}

interface Condition {
    text?: string;
    role?: string;
    scopeRef?: string;
    scopeExact: boolean;
    gone: boolean;
    timeoutMs: number;
}

const savedStates = new SavedStates();
let resourceScheduler = new ResourceScheduler();

const COMMAND_TIMEOUT_MS = 15_000;
const LOOK_TIMEOUT_MS = 33_000;
const ACTION_SETTLE_MS = 280;
const EXPLICIT_IMAGE_MAX_DIMENSION = 1_280;
const DEFAULT_LIST_LIMIT = 20;

function operationState(): OperationState {
    return savedStates.current();
}

function desktopResourceKey(target: Pick<CurrentTarget, "pid">): string {
    return `desktop-pid:${target.pid}`;
}

function persistOperation(state: OperationState): void {
    if (!state.currentTarget || !state.currentCapture || !state.currentLook || !state.currentOutline) return;
    const resourceKey = state.resourceKey ?? desktopResourceKey(state.currentTarget);
    const epoch = state.epoch ?? resourceScheduler.epoch(resourceKey);
    savedStates.saveDesktop(state, resourceKey, epoch);
}

export async function shutdownComputerUseSession(): Promise<void> {
    await resourceScheduler.close();
    resourceScheduler = new ResourceScheduler();
    savedStates.clear();
    await currentPlatformBackend.shutdown?.();
}

function currentRuntimeMode(): ExecutionVariant {
    return isHeadlessMode() ? "stealth" : "default";
}

function currentDeliveryPolicy(): DeliveryPolicy {
    if (isHeadlessMode()) return "background";
    const value = (process.env.PI_COMPUTER_USE_DELIVERY_POLICY ?? "default").toLowerCase();
    return value === "background" ? "background" : value === "foreground" ? "foreground" : value === "ax_only" ? "ax_only" : "default";
}

function executionTrace(strategy: ExecutionTrace["strategy"], metadata: Omit<ExecutionTrace, "strategy" | "runtimeMode"> = {}): ExecutionTrace {
    return { strategy, runtimeMode: currentRuntimeMode(), ...metadata };
}

function settleMsForExecution(execution: ExecutionTrace): number {
    if (execution.rootDelta?.length) return 0;
    return execution.runtimeMode === "stealth" ? 120 : ACTION_SETTLE_MS;
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new Error("Operation aborted.");
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (ms <= 0) return;
    throwIfAborted(signal);
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
        const onAbort = () => { cleanup(); reject(new Error("Operation aborted.")); };
        const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

async function withWindowWriteLock<T>(target: Pick<CurrentTarget, "pid">, work: () => Promise<T>): Promise<T> {
    const state = operationState();
    const key = desktopResourceKey(target);
    const baseEpoch = state.epoch ?? resourceScheduler.epoch(key);
    const result = await resourceScheduler.write(key, baseEpoch, async (nextEpoch) => {
        state.resourceKey = key;
        state.epoch = nextEpoch;
        return await work();
    });
    return result.value;
}

function trimOrUndefined(value: string | undefined): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeText(value: string | undefined): string {
    return (value ?? "").trim().toLowerCase();
}

function outlineNodeCenter(node: OutlineNode): { x: number; y: number } {
    if (!node.rect) throw new Error(`Element ${elementIndexForNode(node)} has no coordinates. Re-observe with a screenshot.`);
    return { x: node.rect.x + node.rect.w / 2, y: node.rect.y + node.rect.h / 2 };
}

function validateStateId(stateId?: string): CurrentCapture {
    const state = operationState();
    if (!state.currentCapture) throw new Error("No observation state is available. Call get_window_state first.");
    if (stateId && state.currentCapture.stateId !== stateId) {
        throw new Error(`Stale state '${stateId}'. The active observation is '${state.currentCapture.stateId}'. Observe again.`);
    }
    if (!state.currentTarget) throw new Error("The observation has no target window. Call get_window_state again.");
    return state.currentCapture;
}

function outlineNodeByRef(ref: string): OutlineNode {
    const state = operationState();
    const node = state.currentOutline ? nodeByRef(state.currentOutline, ref) : undefined;
    if (!node) throw new Error(`Element reference '${ref}' is stale or unavailable. Call get_window_state again.`);
    return node;
}

function wireRefForNode(node: OutlineNode): string {
    if (node.pictureOnly || !node.wireRef) throw new Error(`Element ${elementIndexForNode(node)} has no semantic UIA element. Use coordinates.`);
    return node.wireRef;
}

function currentLookOrThrow(): LookResponse {
    const state = operationState();
    if (!state.currentLook || !state.currentCapture) throw new Error("No current observation. Call get_window_state first.");
    return state.currentLook;
}

function ensurePointIsInLookImage(x: number, y: number, look: LookResponse, errorPrefix = "Coordinates"): void {
    if (!look.image?.jpegBase64) throw new Error(`${errorPrefix} require a screenshot-bearing state. Call get_window_state with includeScreenshot:true.`);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`${errorPrefix} must be finite numbers.`);
    if (x < 0 || y < 0 || x >= look.image.width || y >= look.image.height) {
        throw new Error(`${errorPrefix} (${Math.round(x)},${Math.round(y)}) are outside the screenshot (${look.image.width}x${look.image.height}). Observe again.`);
    }
}

function setCurrentTarget(target: ResolvedTarget): void {
    operationState().currentTarget = {
        appName: target.appName,
        pid: target.pid,
        windowTitle: target.windowTitle,
        windowId: target.windowId,
        nativeWindowRef: target.nativeWindowRef,
        kind: target.kind,
        framePoints: target.framePoints,
        scaleFactor: target.scaleFactor,
        isMinimized: target.isMinimized,
        isOnscreen: target.isOnscreen,
        isFocused: target.isFocused,
    };
}

function publicWindow(target: CurrentTarget): WindowRef {
    return {
        app: target.appName,
        id: target.windowId > 0 ? target.windowId : target.nativeWindowRef ?? "",
        title: target.windowTitle,
    };
}

function publicWindowDetails(target: CurrentTarget): WindowDetails {
    return {
        ...publicWindow(target),
        kind: target.kind as WindowDetails["kind"],
        pid: target.pid,
        isForeground: target.isFocused,
        isMinimized: target.isMinimized,
        bounds: target.framePoints,
    };
}

function resolvedTargetFromCurrent(target: CurrentTarget): ResolvedTarget {
    return {
        ...target,
        framePoints: target.framePoints ?? { x: 0, y: 0, w: 0, h: 0 },
        scaleFactor: target.scaleFactor ?? 1,
        isMinimized: target.isMinimized ?? false,
        isOnscreen: target.isOnscreen ?? true,
        isFocused: target.isFocused ?? false,
    };
}

function toResolvedTarget(root: PlatformRoot): ResolvedTarget {
    const appName = root.appName?.trim() || "Unknown";
    return {
        appName,
        pid: root.pid ?? 0,
        windowTitle: root.title || "(untitled)",
        windowId: root.windowId ?? 0,
        nativeWindowRef: root.windowRef ?? root.rootRef,
        kind: root.kind,
        framePoints: root.framePoints,
        scaleFactor: root.scaleFactor,
        isMinimized: root.isMinimized,
        isOnscreen: root.isOnscreen,
        isFocused: root.isFocused,
    };
}

function windowIdMatches(window: WindowRef, target: CurrentTarget): boolean {
    if (typeof window.id === "number" && target.windowId > 0) return window.id === target.windowId;
    const id = String(window.id);
    if (target.nativeWindowRef && id === target.nativeWindowRef) return true;
    return target.windowId > 0 && id === String(target.windowId);
}

function windowMatchesTarget(window: WindowRef, target: CurrentTarget): boolean {
    if (!windowIdMatches(window, target)) return false;
    const app = normalizeText(window.app);
    return !app || app === normalizeText(target.appName) || app === "unknown";
}

function verifyWindow(window: WindowRef, target: CurrentTarget): void {
    if (!windowMatchesTarget(window, target)) {
        throw new Error(`Window '${window.app}' (${window.id}) does not match the observed window '${target.appName}' (${target.windowId || target.nativeWindowRef}). Call get_window_state again.`);
    }
}

async function resolvePublicWindow(window: WindowRef, signal?: AbortSignal): Promise<ResolvedTarget> {
    const roots = await currentPlatformBackend.listRoots({}, signal);
    const byId = roots.filter((root) => {
        if (typeof window.id === "number") return root.windowId === window.id;
        return root.windowRef === window.id || root.rootRef === window.id;
    });
    const app = normalizeText(window.app);
    const candidates = byId.length > 0 ? byId : roots.filter((root) => normalizeText(root.appName) === app);
    const match = candidates.find((root) => normalizeText(root.title) === normalizeText(window.title))
        ?? candidates.find((root) => root.isFocused)
        ?? candidates[0];
    if (!match) throw new Error(`Window '${window.app}' (${window.id}) was not found. Call list_apps again.`);
    return toResolvedTarget(match);
}

function sameRootIdentity(a: CurrentTarget, b: CurrentTarget): boolean {
    if (a.pid !== b.pid) return false;
    if (a.windowId > 0 && b.windowId > 0) return a.windowId === b.windowId;
    if (a.nativeWindowRef && b.nativeWindowRef) return a.nativeWindowRef === b.nativeWindowRef;
    return normalizeText(a.windowTitle) === normalizeText(b.windowTitle);
}

async function ensureReady(ctx: ExtensionContext, signal?: AbortSignal): Promise<void> {
    loadComputerUseConfig(ctx.cwd);
    throwIfAborted(signal);
    await currentPlatformBackend.ensureReady(ctx, {}, signal);
}

function captureForLook(look: LookResponse): CurrentCapture {
    return {
        stateId: randomUUID(),
        width: look.image?.width ?? 0,
        height: look.image?.height ?? 0,
        scaleFactor: look.window.scaleFactor,
        timestamp: Date.now(),
    };
}

async function performLook(target: ResolvedTarget, includeText: boolean, includeImage: boolean, signal?: AbortSignal): Promise<LookResponse> {
    if (target.windowId <= 0 && !target.nativeWindowRef) throw new Error(`Window '${target.windowTitle}' has no stable id. Call list_apps again.`);
    return await currentPlatformBackend.observe({
        target: { pid: target.pid, windowId: target.windowId, rootRef: target.nativeWindowRef },
        readText: includeText ? "always" : "never",
        includeImage,
        maxDimension: includeImage ? EXPLICIT_IMAGE_MAX_DIMENSION : 1,
    }, { signal, timeoutMs: LOOK_TIMEOUT_MS });
}

async function captureTarget(
    target: ResolvedTarget,
    state: OperationState,
    options: { includeText: boolean; includeScreenshot: boolean },
    signal?: AbortSignal,
): Promise<CaptureResult> {
    const look = await performLook(target, options.includeText, options.includeScreenshot, signal);
    const outline = stabilizeRefs(
        state.currentOutline && state.currentTarget && sameRootIdentity(state.currentTarget, target) ? state.currentOutline : undefined,
        look.parsedOutline!,
    );
    look.parsedOutline = outline;
    look.outline = outline.root;
    const capture = captureForLook(look);
    setCurrentTarget(target);
    state.currentCapture = capture;
    state.currentLook = look;
    state.currentOutline = outline;
    state.resourceKey = desktopResourceKey(target);
    state.epoch ??= resourceScheduler.epoch(state.resourceKey);
    return { target, capture, look, outline };
}

function focusedElement(outline: Outline): string | undefined {
    const node = outline.nodes.find((candidate) => candidate.focused);
    return node ? `${elementIndexForNode(node)} ${node.role} ${JSON.stringify(outlineNodeLabel(node))}` : undefined;
}

function accessibilityView(fold: FoldResult, outline: Outline): AccessibilityView {
    return {
        tree: fold.text,
        focusedElement: focusedElement(outline),
        truncated: fold.truncated,
        nodeCount: outline.nodes.length,
        returned: fold.renderedRefs.length,
    };
}

function screenshotView(stateId: string, look: LookResponse, includeData: boolean): ScreenshotView | null {
    if (!look.image?.jpegBase64) return null;
    return {
        screenshotId: stateId,
        width: look.image.width,
        height: look.image.height,
        originX: 0,
        originY: 0,
        dataUrl: includeData ? `data:${look.image.mimeType ?? "image/jpeg"};base64,${look.image.jpegBase64}` : undefined,
        coordinateGuidance: `Screenshot size: ${look.image.width} * ${look.image.height} pixels. All x/y values are window-relative screenshot pixels.`,
    };
}

function fullAccessibility(outline: Outline): AccessibilityView {
    return accessibilityView(foldToBudget(outline), outline);
}

function queryAccessibility(outline: Outline, query: NonNullable<GetWindowStateParams["query"]>): { accessibility: AccessibilityView; matches: number } {
    const text = trimOrUndefined(query.text);
    const role = trimOrUndefined(query.role);
    const capability = trimOrUndefined(query.capability);
    if (!text && !role && !capability) throw new Error("get_window_state.query requires text, role, or capability.");
    const limit = Math.max(1, Math.min(50, Math.trunc(query.limit ?? 12)));
    const ranked = searchOutlineRanked(outline, text, role, capability, limit);
    const lines = ranked.matches.map((match) => {
        const node = outline.nodes.find((candidate) => candidate.ref === match.ref)!;
        const path = [];
        let current: OutlineNode | undefined = node;
        while (current) {
            path.unshift(elementIndexForNode(current));
            current = current.parent;
        }
        return `${elementIndexForNode(node)} ${match.role || "unknown"} ${JSON.stringify(match.label || "(unlabeled)")} [${match.matchReason}] path: ${path.join(" > ")}`;
    });
    const tree = lines.length ? `Matches ${ranked.totalMatches}, returned ${ranked.matches.length}:\n${lines.join("\n")}` : "No matches.";
    return {
        accessibility: {
            tree,
            nodeCount: outline.nodes.length,
            returned: ranked.matches.length,
            focusedElement: focusedElement(outline),
        },
        matches: ranked.totalMatches,
    };
}

function elementAccessibility(outline: Outline, elementIndex: number, depth: number): AccessibilityView {
    const node = nodeByElementIndex(outline, elementIndex);
    if (!node) throw new Error(`Element index ${elementIndex} is not present in this state. Query the tree or observe again.`);
    const fold = renderOutlineSubtree(node, depth);
    return {
        ...accessibilityView(fold, outline),
        nodeCount: fold.nodeCount,
    };
}

function buildStateResult(
    target: CurrentTarget,
    state: OperationState,
    options: {
        includeText: boolean;
        includeScreenshot: boolean;
        screenshotData: boolean;
        query?: GetWindowStateParams["query"];
        elementIndex?: number;
        depth?: number;
    },
): AgentToolResult<WindowStateResult> {
    if (!state.currentCapture || !state.currentOutline || !state.currentLook) throw new Error("No observation is available. Call get_window_state first.");
    const outline = state.currentOutline;
    let accessibility: AccessibilityView | null = null;
    let matches: number | undefined;
    if (options.elementIndex !== undefined) {
        accessibility = elementAccessibility(outline, options.elementIndex, options.depth ?? 2);
    } else if (options.query) {
        const result = queryAccessibility(outline, options.query);
        accessibility = result.accessibility;
        matches = result.matches;
    } else if (options.includeText) {
        accessibility = fullAccessibility(outline);
    }
    const screenshot = options.includeScreenshot ? screenshotView(state.currentCapture.stateId, state.currentLook, options.screenshotData) : null;
    const result: WindowStateResult = {
        stateId: state.currentCapture.stateId,
        window: publicWindow(target),
        accessibility,
        screenshots: screenshot ? [screenshot] : [],
        matches,
        activation: { activated: false, raised: false, unminimized: false },
    };
    const header = `Window ${target.appName} ${JSON.stringify(target.windowTitle)}\nstateId ${result.stateId}${screenshot ? ` - screenshot ${screenshot.width}*${screenshot.height}` : options.includeScreenshot ? " - no screenshot in this state. Use refresh to capture" : ""}`;
    const text = `${header}${accessibility ? `\n\n${accessibility.tree}` : ""}`;
    const content: AgentToolResult<WindowStateResult>["content"] = [{ type: "text", text }];
    if (screenshot && state.currentLook.image) content.push({ type: "image", data: state.currentLook.image.jpegBase64, mimeType: state.currentLook.image.mimeType ?? "image/jpeg" });
    return { content, details: result };
}

function changeToPublic(change: OutlineChange): Change {
    const index = (ref: string) => outlineRefIndex(ref);
    if (change.type === "added") return { type: change.type, elementIndex: index(change.ref), parentIndex: change.parent ? index(change.parent) : undefined };
    if (change.type === "removed") return { type: change.type, elementIndex: index(change.ref), parentIndex: change.parent ? index(change.parent) : undefined };
    return { type: change.type, elementIndex: index(change.ref), path: change.path.map(index), fields: change.fields };
}

function outcomeTrace(result: HelperActResult, policy = currentDeliveryPolicy()): ExecutionTrace {
    return executionTrace("act", {
        outcome: result.outcome,
        delivery: result.performed?.delivery,
        deliveryPolicy: policy,
        error: result.error,
        rootDelta: result.rootDelta,
        stoppedAt: result.stoppedAt,
    });
}

async function helperAct(target: ResolvedTarget, action: Exclude<PreparedAction, never>, headless: boolean, signal?: AbortSignal): Promise<ExecutionTrace> {
    const checked = (candidate: HelperActResult): HelperActResult => {
        if (!candidate || !["worked", "didnt", "unknown"].includes(candidate.outcome)) throw new Error("Helper act returned an invalid outcome.");
        return candidate;
    };
    const textTimeout = "text" in action.params ? action.params.text.length * 25 + 4_000 : 0;
    const timeoutMs = Math.max(COMMAND_TIMEOUT_MS, textTimeout);
    if ((action.usesCurrentFocus || action.needsForeground) && !headless) {
        const foreground = checked(await currentPlatformBackend.act(helperActRequest(target, action, "foreground"), { signal, timeoutMs }));
        const trace = outcomeTrace(foreground, "foreground");
        trace.backgroundFirst = false;
        return trace;
    }
    try {
        const initialPolicy = headless ? "ax_only" : "background";
        const result = checked(await currentPlatformBackend.act(helperActRequest(target, action, initialPolicy), { signal, timeoutMs }));
        if (canRetryInForeground(action, result.outcome, headless)) {
            const foreground = checked(await currentPlatformBackend.act(helperActRequest(target, action, "foreground"), { signal, timeoutMs }));
            const trace = outcomeTrace(foreground, "foreground");
            trace.backgroundFirst = true;
            trace.escalatedToForeground = true;
            trace.escalationReason = "side_effect_free_didnt";
            return trace;
        }
        const trace = outcomeTrace(result, "background");
        trace.backgroundFirst = true;
        return trace;
    } catch (error) {
        const code = (error as Error & { code?: string })?.code;
        if (code !== "foreground_required" || headless) throw error;
        const foreground = checked(await currentPlatformBackend.act(helperActRequest(target, action, "foreground"), { signal, timeoutMs }));
        const trace = outcomeTrace(foreground, "foreground");
        trace.backgroundFirst = true;
        trace.escalatedToForeground = true;
        trace.escalationReason = code;
        return trace;
    }
}

function helperActRequest(target: ResolvedTarget, action: PreparedAction, policy = currentDeliveryPolicy()): PlatformActRequest {
    const look = currentLookOrThrow();
    const base = { lookId: look.lookId, pid: target.pid, target: action.target, policy };
    switch (action.action) {
        case "press":
        case "click": return { ...base, action: action.action, params: action.params };
        case "setText": return { ...base, action: action.action, params: { text: action.params.text } };
        case "typeText": return { ...base, action: action.action, params: { text: action.params.text } };
        case "keypress": return { ...base, action: action.action, params: { keys: action.params.keys } };
        case "scroll": return { ...base, action: action.action, params: { scrollX: action.params.scrollX, scrollY: action.params.scrollY } };
        case "drag": return { ...base, action: action.action, params: { path: action.params.path } };
    }
}

function prepareUiAction(action: EngineAction, state: ActionState, look: LookResponse, headless: boolean): PreparedAction {
    return prepareAction(action, state, {
        headless,
        image: look.image,
        node: outlineNodeByRef,
        center: outlineNodeCenter,
        validatePoint: (x, y, label) => ensurePointIsInLookImage(x, y, look, label),
    });
}

async function dispatchUiAction(action: EngineAction, target: ResolvedTarget, look: LookResponse, headless: boolean, state: ActionState, signal?: AbortSignal): Promise<ExecutionTrace> {
    const prepared = prepareUiAction(action, state, look, headless);
    const trace = await helperAct(target, prepared, headless, signal);
    if (!headless && (prepared.establishesFocus || (prepared.action === "click" && "x" in prepared.target))) state.currentFocus = true;
    return trace;
}

async function dispatchUiTransaction(actions: EngineAction[], target: ResolvedTarget, look: LookResponse, headless: boolean, signal?: AbortSignal): Promise<ExecutionTrace> {
    if (headless && currentPlatformBackend.actBatch) {
        const actionState: ActionState = { currentFocus: false };
        const requests = actions.map((action) => helperActRequest(target, prepareUiAction(action, actionState, look, true), "ax_only"));
        const textLength = actions.reduce((sum, action) => sum + (action.text?.length ?? 0), 0);
        const result = await currentPlatformBackend.actBatch(requests, { signal, timeoutMs: Math.max(COMMAND_TIMEOUT_MS, textLength * 25 + 6_000) });
        if (!result.steps || result.steps.length === 0) throw new Error("Native action transaction returned no checked steps.");
        const steps = result.steps.map((step) => outcomeTrace(step, "ax_only"));
        const outcome: ActOutcome = steps.some((step) => step.outcome === "didnt") ? "didnt" : steps.some((step) => step.outcome === "unknown") ? "unknown" : "worked";
        return executionTrace("act", { outcome, rootDelta: result.rootDelta, stoppedAt: result.stoppedAt, actionCount: steps.length, steps });
    }
    const steps: ExecutionTrace[] = [];
    const actionState: ActionState = { currentFocus: false };
    for (const action of actions) {
        const step = await dispatchUiAction(action, target, look, headless, actionState, signal);
        steps.push(step);
        if (step.outcome === "didnt") break;
    }
    const outcome: ActOutcome = steps.some((step) => step.outcome === "didnt") ? "didnt" : steps.some((step) => step.outcome === "unknown") ? "unknown" : "worked";
    return executionTrace("act", { outcome, steps, actionCount: steps.length, rootDelta: steps.flatMap((step) => step.rootDelta ?? []) });
}

function normalizeTimeout(value: unknown, fallback = 10_000): number {
    return Math.max(100, Math.min(60_000, Math.trunc(typeof value === "number" && Number.isFinite(value) ? value : fallback)));
}

function conditionFromInput(input: { text?: string; role?: string; elementIndex?: number; until?: "present" | "absent"; timeoutMs?: number }, outline: Outline): Condition {
    const text = trimOrUndefined(input.text);
    const role = trimOrUndefined(input.role);
    const node = input.elementIndex !== undefined ? nodeByElementIndex(outline, input.elementIndex) : undefined;
    if (input.elementIndex !== undefined && !node) throw new Error(`Element index ${input.elementIndex} is not present in this state.`);
    if (!text && !role && !node) throw new Error("A wait condition requires text, role, or elementIndex.");
    if (role && !text && !node) throw new Error("A role-only wait condition requires elementIndex.");
    return {
        text: text ?? (node ? outlineNodeLabel(node) || node.role : undefined),
        role,
        scopeRef: node?.ref,
        scopeExact: false,
        gone: input.until === "absent",
        timeoutMs: normalizeTimeout(input.timeoutMs),
    };
}

function nodeWithinScope(node: OutlineNode, scopeRef: string | undefined): boolean {
    if (!scopeRef) return true;
    let current: OutlineNode | undefined = node;
    while (current) {
        if (current.ref === scopeRef) return true;
        current = current.parent;
    }
    return false;
}

function normalizedRole(value: string): string {
    return value.toLowerCase().replace(/^ax/, "").replace(/[ _-]+/g, "");
}

function platformRole(outline: Outline, role: string | undefined): string | undefined {
    if (!role) return undefined;
    return outline.nodes.find((node) => normalizedRole(node.role) === normalizedRole(role))?.role ?? role;
}

function conditionPresent(outline: Outline, condition: Condition): boolean {
    if (!condition.text) return false;
    return searchOutline(outline, condition.text, undefined, undefined, outline.nodes.length)
        .some((match) => (!condition.role || normalizedRole(match.node.role) === normalizedRole(condition.role)) && nodeWithinScope(match.node, condition.scopeRef));
}

function conditionScopeNode(outline: Outline, condition: Condition): OutlineNode | undefined {
    if (!condition.scopeRef) return undefined;
    const node = nodeByRef(outline, condition.scopeRef);
    if (!node) throw new Error("The condition scope element is unavailable in this state.");
    return node;
}

function rootDeltaLines(execution: ExecutionTrace): string[] {
    return (execution.rootDelta ?? []).map((delta) => {
        const title = delta.title ? ` ${JSON.stringify(delta.title)}` : "";
        if (delta.change === "appeared") return `New root: ${delta.kind}${title}`;
        if (delta.change === "closed") return `Root closed: ${delta.kind}${title}`;
        return `Root focused: ${delta.kind}${title}`;
    });
}

function terminalAct(outcome: ActOutcome, error: unknown, window: WindowRef): AgentToolResult<ActResult> {
    const message = error instanceof Error ? error.message : String(error);
    const details: ActResult = {
        window,
        outcome,
        view: "diff",
        error: { code: "post_action_observation_failed", message },
        activation: { activated: false, raised: false, unminimized: false },
    };
    return {
        content: [{ type: "text", text: `Action outcome ${outcome}, but the successor state could not be captured: ${message}\nCall list_apps and get_window_state to continue.` }],
        details,
    };
}

async function performAct(params: ActParams, signal?: AbortSignal): Promise<AgentToolResult<ActResult>> {
    if (!Array.isArray(params.actions) || params.actions.length === 0) throw new Error("act.actions must contain at least one action.");
    if (params.actions.length > 20) throw new Error("act supports at most 20 actions per transaction.");
    const state = operationState();
    validateStateId(params.stateId);
    const target = resolvedTargetFromCurrent(state.currentTarget!);
    verifyWindow(params.window, target);
    const look = currentLookOrThrow();
    const baseView = { stateId: state.currentCapture!.stateId, outline: state.currentOutline! };
    const condition = params.expect ? conditionFromInput(params.expect, baseView.outline) : undefined;
    const scopeNode = condition ? conditionScopeNode(baseView.outline, condition) : undefined;
    const engineActions: EngineAction[] = [];
    let shouldActivate = false;

    for (const action of params.actions) {
        if (action.type === "activate") {
            shouldActivate = true;
            continue;
        }
        if (action.type === "click") {
            if (action.screenshotId && action.screenshotId !== state.currentCapture!.stateId) throw new Error("click.screenshotId is stale. Observe again.");
            const hasElement = action.elementIndex !== undefined;
            const hasPoint = Number.isFinite(action.x) && Number.isFinite(action.y);
            if (hasElement === hasPoint) throw new Error("click requires exactly one of elementIndex or x/y.");
            if (hasElement) {
                const node = nodeByElementIndex(baseView.outline, action.elementIndex!);
                if (!node) throw new Error(`Element index ${action.elementIndex} is not present in this state.`);
                engineActions.push({ action: "press", ref: node.ref, button: action.button, clickCount: action.count });
            } else {
                engineActions.push({ action: "click", x: action.x, y: action.y, button: action.button, clickCount: action.count });
            }
        } else if (action.type === "type_text") {
            engineActions.push({ action: "typeText", ref: action.elementIndex !== undefined ? nodeRefForIndex(baseView.outline, action.elementIndex) : undefined, text: action.text });
        } else if (action.type === "press_key") {
            if (!action.key.trim()) throw new Error("press_key.key must not be empty.");
            engineActions.push({ action: "keypress", ref: action.elementIndex !== undefined ? nodeRefForIndex(baseView.outline, action.elementIndex) : undefined, keys: [action.key] });
        } else if (action.type === "set_value") {
            engineActions.push({ action: "setText", ref: nodeRefForIndex(baseView.outline, action.elementIndex), text: action.value });
        } else if (action.type === "scroll") {
            if (action.screenshotId && action.screenshotId !== state.currentCapture!.stateId) throw new Error("scroll.screenshotId is stale. Observe again.");
            const ref = action.elementIndex !== undefined ? nodeRefForIndex(baseView.outline, action.elementIndex) : undefined;
            if (!ref && !(Number.isFinite(action.x) && Number.isFinite(action.y))) throw new Error("scroll requires elementIndex or x/y.");
            if ((action.deltaX ?? 0) === 0 && (action.deltaY ?? 0) === 0) throw new Error("scroll requires a non-zero deltaX or deltaY.");
            engineActions.push({ action: "scroll", ref, x: action.x, y: action.y, scrollX: action.deltaX ?? 0, scrollY: action.deltaY ?? 0 });
        } else if (action.type === "drag") {
            if (action.screenshotId && action.screenshotId !== state.currentCapture!.stateId) throw new Error("drag.screenshotId is stale. Observe again.");
            engineActions.push({ action: "drag", path: [action.from, action.to] });
        }
    }

    if (!engineActions.length && !shouldActivate) throw new Error("act.actions did not contain a performable action.");
    if (shouldActivate) {
        await currentPlatformBackend.focusWindow({ pid: target.pid, windowId: target.windowId, rootRef: target.nativeWindowRef }, signal);
    }

    return await withWindowWriteLock(target, async () => {
        const headless = getComputerUseConfig().headless;
        const execution = engineActions.length
            ? await dispatchUiTransaction(engineActions, target, look, headless, signal)
            : executionTrace("act", { outcome: "worked" });
        const executedActions = engineActions.slice(0, execution.actionCount ?? engineActions.length);
        try {
            if (condition) {
                const beforePresent = conditionPresent(baseView.outline, condition);
                const desiredWasPreexisting = beforePresent !== condition.gone;
                const verification = await currentPlatformBackend.waitFor({
                    pid: target.pid,
                    windowId: target.windowId,
                    rootRef: target.nativeWindowRef,
                    lookId: look.lookId,
                    text: condition.text,
                    role: platformRole(baseView.outline, condition.role),
                    scopeRef: scopeNode ? wireRefForNode(scopeNode) : undefined,
                    scopeExact: condition.scopeExact,
                    gone: condition.gone,
                    timeoutMs: condition.timeoutMs,
                }, { signal, timeoutMs: condition.timeoutMs + 2_000 });
                execution.verification = {
                    status: verification.found ? (desiredWasPreexisting ? "preexisting" : "verified") : "failed",
                    text: condition.text,
                    role: condition.role,
                    gone: condition.gone || undefined,
                    timeoutMs: condition.timeoutMs,
                };
                execution.outcome = outcomeAfterCheck(execution.outcome ?? "unknown", execution.verification.status);
                if (!verification.found) execution.error = { code: "postcondition_failed", message: `Postcondition was not satisfied within ${condition.timeoutMs}ms.` };
            } else {
                await sleep(settleMsForExecution(execution), signal);
            }
            const capture = await captureTarget(target, state, { includeText: true, includeScreenshot: false }, signal);
            execution.outcome = outcomeAfterObservedValues(execution.outcome ?? "unknown", executedActions, (ref) => nodeByRef(capture.outline, ref)?.value);
            const transition = changesBetween(baseView.outline, capture.outline);
            const useDiff = !transition.useFullView;
            const details: ActResult = {
                stateId: capture.capture.stateId,
                window: publicWindow(target),
                outcome: execution.outcome ?? "unknown",
                verification: execution.verification,
                view: useDiff ? "diff" : "full",
                changes: useDiff ? transition.changes.map(changeToPublic) : undefined,
                accessibility: useDiff ? undefined : fullAccessibility(capture.outline),
                error: execution.error?.message ? { code: execution.error.code ?? "action_error", message: execution.error.message } : undefined,
                activation: shouldActivate
                    ? { activated: true, raised: true, unminimized: false }
                    : { activated: false, raised: false, unminimized: false },
            };
            const delta = rootDeltaLines(execution);
            const summary = `Outcome ${details.outcome}. ${baseView.stateId} -> ${details.stateId}.`;
            const viewText = useDiff
                ? `${renderChanges(transition.changes) || "(no element changes)"}\nUse stateId ${details.stateId} for the next call.`
                : details.accessibility?.tree ?? "";
            return { content: [{ type: "text", text: `${summary}${delta.length ? `\n${delta.join("\n")}` : ""}\n\n${viewText}` }], details };
        } catch (error) {
            if (signal?.aborted) throw error;
            return terminalAct(execution.outcome ?? "unknown", error, params.window);
        }
    });
}

function nodeRefForIndex(outline: Outline, index: number): string {
    const node = nodeByElementIndex(outline, index);
    if (!node) throw new Error(`Element index ${index} is not present in this state.`);
    return node.ref;
}

async function performGetWindowState(params: GetWindowStateParams, signal?: AbortSignal): Promise<AgentToolResult<WindowStateResult>> {
    const state = operationState();
    const includeText = Boolean(params.includeText || params.query || params.elementIndex !== undefined);
    const includeScreenshot = params.includeScreenshot ?? (params.screenshotData ? true : !(params.stateId && !params.refresh));
    if (params.stateId && !params.refresh) {
        validateStateId(params.stateId);
        verifyWindow(params.window, state.currentTarget!);
        return buildStateResult(state.currentTarget!, state, {
            includeText,
            includeScreenshot,
            screenshotData: params.screenshotData ?? false,
            query: params.query,
            elementIndex: params.elementIndex,
            depth: params.depth,
        });
    }
    const target = await resolvePublicWindow(params.window, signal);
    if (params.stateId) verifyWindow(params.window, target);
    const key = desktopResourceKey(target);
    const capture = (await resourceScheduler.read(key, async (epoch) => {
        state.epoch = epoch;
        state.resourceKey = key;
        return await captureTarget(target, state, { includeText, includeScreenshot }, signal);
    })).value;
    return buildStateResult(capture.target, state, {
        includeText,
        includeScreenshot,
        screenshotData: params.screenshotData ?? false,
        query: params.query,
        elementIndex: params.elementIndex,
        depth: params.depth,
    });
}

async function performWaitFor(params: WaitForParams, signal?: AbortSignal): Promise<AgentToolResult<WaitForResult>> {
    const state = operationState();
    if (params.stateId) validateStateId(params.stateId);
    let target: ResolvedTarget;
    if (state.currentTarget && state.currentCapture && state.currentOutline) {
        verifyWindow(params.window, state.currentTarget);
        target = resolvedTargetFromCurrent(state.currentTarget);
    } else {
        target = await resolvePublicWindow(params.window, signal);
        const key = desktopResourceKey(target);
        await resourceScheduler.read(key, async (epoch) => {
            state.epoch = epoch;
            state.resourceKey = key;
            return await captureTarget(target, state, { includeText: true, includeScreenshot: false }, signal);
        });
    }
    if (!state.currentLook || !state.currentOutline || !state.currentCapture) throw new Error("No observation state is available.");
    const baseView = { stateId: state.currentCapture.stateId, outline: state.currentOutline };
    const condition = conditionFromInput(params, baseView.outline);
    const scopeNode = conditionScopeNode(baseView.outline, condition);
    const raw = await currentPlatformBackend.waitFor({
        pid: target.pid,
        windowId: target.windowId,
        rootRef: target.nativeWindowRef,
        lookId: baseView.outline.lookId,
        text: condition.text,
        role: platformRole(baseView.outline, condition.role),
        scopeRef: scopeNode ? wireRefForNode(scopeNode) : undefined,
        scopeExact: condition.scopeExact,
        gone: condition.gone,
        timeoutMs: condition.timeoutMs,
    }, { signal, timeoutMs: condition.timeoutMs + 2_000 });
    const key = state.resourceKey ?? desktopResourceKey(target);
    const refreshed = (await resourceScheduler.readAt(key, state.epoch ?? 0, async () => await captureTarget(target, state, { includeText: true, includeScreenshot: false }, signal))).value;
    const transition = changesBetween(baseView.outline, refreshed.outline);
    const useDiff = !transition.useFullView;
    const matches = searchOutline(refreshed.outline, condition.text, condition.role, undefined, 1);
    const match = matches[0];
    const details: WaitForResult = {
        found: raw.found,
        timedOut: raw.timedOut || undefined,
        stateId: refreshed.capture.stateId,
        view: useDiff ? "diff" : "full",
        changes: useDiff ? transition.changes.map(changeToPublic) : undefined,
        accessibility: useDiff ? undefined : fullAccessibility(refreshed.outline),
        match: match ? { elementIndex: elementIndexForNode(match.node), role: match.role, label: match.label } : undefined,
    };
    const message = details.found ? (condition.gone ? "Condition disappeared." : "Condition appeared.") : `Timed out after ${condition.timeoutMs}ms.`;
    const viewText = useDiff ? `${renderChanges(transition.changes) || "(no element changes)"}\nUse stateId ${details.stateId} for the next call.` : details.accessibility?.tree ?? "";
    return { content: [{ type: "text", text: `${message}\n${viewText}` }], details };
}

async function performListApps(params: ListAppsParams, signal?: AbortSignal): Promise<AgentToolResult<ListAppsResult>> {
    const roots = await currentPlatformBackend.listRoots({}, signal);
    const includeMinimized = params.includeMinimized ?? true;
    const appFilter = normalizeText(params.app);
    const titleFilter = normalizeText(params.title);
    const filtered = roots.filter((root) => {
        if (!includeMinimized && root.isMinimized) return false;
        if (params.pid !== undefined && root.pid !== params.pid) return false;
        if (appFilter && normalizeText(root.appName) !== appFilter) return false;
        if (titleFilter && !normalizeText(root.title).includes(titleFilter)) return false;
        return true;
    }).sort((a, b) => Number(b.isFocused) - Number(a.isFocused) || a.zOrder - b.zOrder);
    const total = filtered.length;
    const limit = Math.max(1, Math.min(100, Math.trunc(params.limit ?? DEFAULT_LIST_LIMIT)));
    const windows = filtered.slice(0, limit).map((root) => publicWindowDetails(toResolvedTarget(root)));
    const groups = new Map<string, ListAppsResult["apps"][number]>();
    for (const window of windows) {
        const key = `${window.pid ?? 0}:${window.app}`;
        let group = groups.get(key);
        if (!group) {
            group = { app: window.app, name: window.app, pid: window.pid, windows: [] };
            groups.set(key, group);
        }
        group.windows.push(window);
    }
    const result: ListAppsResult = { apps: [...groups.values()], windows, total, returned: windows.length };
    const lines = windows.map((window) => `- ${window.app} ${JSON.stringify(window.title ?? "")} (${window.id}${window.kind ? `, ${window.kind}` : ""}${window.isMinimized ? ", minimized" : ""}${window.isForeground ? ", foreground" : ""})`);
    return {
        content: [{ type: "text", text: `Found ${total} window${total === 1 ? "" : "s"}${total > windows.length ? `, returned ${windows.length}` : ""}.\n${lines.join("\n")}` }],
        details: result,
    };
}

function windowIdentity(root: PlatformRoot): string {
    return root.windowId && root.windowId > 0 ? `id:${root.windowId}` : `ref:${root.windowRef ?? root.rootRef ?? `${root.pid}:${root.title}`}`;
}

function launchedAppName(app: string): string {
    const file = app.replace(/\\/g, "/").split("/").pop() ?? app;
    return normalizeText(file.replace(/\.exe$/i, ""));
}

async function performLaunchApp(params: LaunchAppParams, signal?: AbortSignal): Promise<AgentToolResult<LaunchAppResult>> {
    const app = trimOrUndefined(params.app);
    if (!app) throw new Error("launch_app.app is required.");
    const args = Array.isArray(params.args) ? params.args.map(String) : undefined;
    const waitMs = Math.max(0, Math.min(30_000, Math.trunc(params.waitMs ?? 10_000)));
    const before = await currentPlatformBackend.listRoots({}, signal);
    const beforeIds = new Set(before.map(windowIdentity));
    const appName = launchedAppName(app);
    let launchedPid = 0;
    try {
        const launched = await currentPlatformBackend.launchApp({ app, args, waitMs }, { signal, timeoutMs: waitMs + 5_000 });
        launchedPid = launched.pid ?? 0;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            content: [{ type: "text", text: `launch_app failed: ${message}` }],
            details: { launched: false, windows: [], error: { code: "launch_failed", message } },
        };
    }
    const deadline = Date.now() + waitMs;
    let windows: WindowDetails[] = [];
    while (true) {
        const roots = await currentPlatformBackend.listRoots({}, signal);
        const byPid = launchedPid > 0 ? roots.filter((root) => root.pid === launchedPid) : [];
        const byApp = appName ? roots.filter((root) => normalizeText(root.appName) === appName) : [];
        const fresh = roots.filter((root) => !beforeIds.has(windowIdentity(root)));
        const selected = fresh.length > 0 ? fresh : byPid.length > 0 ? byPid : byApp;
        windows = selected.map((root) => publicWindowDetails(toResolvedTarget(root)));
        if (windows.length > 0 || Date.now() >= deadline) break;
        await sleep(100, signal);
    }
    return {
        content: [{ type: "text", text: `Launched ${app}${launchedPid ? ` (pid ${launchedPid})` : ""}. ${windows.length} window${windows.length === 1 ? "" : "s"} found.` }],
        details: { launched: true, windows },
    };
}

async function executeTool<P, T>(ctx: ExtensionContext, params: P, signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
    const requestedStateId = trimOrUndefined((params as { stateId?: string } | undefined)?.stateId);
    const record = requestedStateId ? savedStates.get(requestedStateId) : undefined;
    if (requestedStateId && !record) throw new Error(`State '${requestedStateId}' is unavailable or was evicted. Call get_window_state again.`);
    const operation = savedStates.hydrate(record);
    return await savedStates.operations.run(operation, async () => {
        await ensureReady(ctx, signal);
        throwIfAborted(signal);
        const result = await run();
        persistOperation(operation);
        return result;
    });
}

function makeToolExecutor<P, D>(tool: string, perform: (params: P, signal?: AbortSignal) => Promise<AgentToolResult<D>>) {
    return async (
        _toolCallId: string,
        params: P,
        signal: AbortSignal | undefined,
        _onUpdate: AgentToolUpdateCallback<D> | undefined,
        ctx: ExtensionContext,
    ): Promise<AgentToolResult<D>> => {
        try {
            const result = await executeTool(ctx, params, signal, () => perform(params, signal));
            const structuredContent = structuredContentFromDetails(result.details);
            return applyOutputEnvelope(tool, structuredContent === undefined ? result : { ...result, structuredContent });
        } catch (error) {
            throw boundToolError(tool, error);
        }
    };
}

export const executeListApps = makeToolExecutor("list_apps", performListApps);
export const executeGetWindowState = makeToolExecutor("get_window_state", performGetWindowState);
export const executeAct = makeToolExecutor("act", performAct);
export const executeWaitFor = makeToolExecutor("wait_for", performWaitFor);
export const executeLaunchApp = makeToolExecutor("launch_app", performLaunchApp);

export async function ensureComputerUseSetup(ctx: ExtensionContext, signal?: AbortSignal): Promise<void> {
    await ensureReady(ctx, signal);
}
