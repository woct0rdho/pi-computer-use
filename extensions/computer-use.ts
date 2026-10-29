import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
    ensureComputerUseSetup,
    executeAct,
    executeGetWindowState,
    executeLaunchApp,
    executeListApps,
    executeWaitFor,
    shutdownComputerUseSession,
} from "../src/bridge.ts";
import { loadComputerUseConfig } from "../src/config.ts";
import {
    actOutputSchema,
    getWindowStateOutputSchema,
    launchAppOutputSchema,
    listAppsOutputSchema,
    waitForOutputSchema,
} from "../src/schemas.ts";

const windowRef = Type.Object({
    app: Type.String({ description: "Opaque app key returned by list_apps" }),
    id: Type.Union([Type.Number(), Type.String()], { description: "Opaque window id returned by list_apps" }),
    title: Type.Optional(Type.String({ description: "Optional title for display. Actions match app and id" })),
});

const elementIndex = Type.Number({ minimum: 1, description: "Element index from the current get_window_state tree" });
const stateId = Type.String({ description: "Observation id from get_window_state" });
const screenshotId = Type.Optional(Type.String({ description: "Screenshot id from the state. Defaults to the single current screenshot" }));
const mouseButton = Type.Optional(Type.Union([Type.Literal("left"), Type.Literal("right"), Type.Literal("middle")]));

const clickAction = Type.Object({
    type: Type.Literal("click"),
    elementIndex: Type.Optional(elementIndex),
    x: Type.Optional(Type.Number({ description: "Window-relative screenshot pixel x" })),
    y: Type.Optional(Type.Number({ description: "Window-relative screenshot pixel y" })),
    screenshotId,
    button: mouseButton,
    count: Type.Optional(Type.Number({ minimum: 1, maximum: 3 })),
});

const typeTextAction = Type.Object({
    type: Type.Literal("type_text"),
    text: Type.String(),
    elementIndex: Type.Optional(elementIndex),
});

const pressKeyAction = Type.Object({
    type: Type.Literal("press_key"),
    key: Type.String({ description: "X-style key or chord, e.g. Return, Tab, Control_L+a" }),
    elementIndex: Type.Optional(elementIndex),
});

const setValueAction = Type.Object({
    type: Type.Literal("set_value"),
    elementIndex,
    value: Type.String(),
});

const scrollAction = Type.Object({
    type: Type.Literal("scroll"),
    elementIndex: Type.Optional(elementIndex),
    x: Type.Optional(Type.Number()),
    y: Type.Optional(Type.Number()),
    deltaX: Type.Optional(Type.Number()),
    deltaY: Type.Optional(Type.Number()),
    screenshotId,
});

const dragAction = Type.Object({
    type: Type.Literal("drag"),
    from: Type.Object({ x: Type.Number(), y: Type.Number() }),
    to: Type.Object({ x: Type.Number(), y: Type.Number() }),
    durationMs: Type.Optional(Type.Number({ minimum: 0, maximum: 10_000 })),
    screenshotId,
});

const activateAction = Type.Object({ type: Type.Literal("activate") });

const uiAction = Type.Union([clickAction, typeTextAction, pressKeyAction, setValueAction, scrollAction, dragAction, activateAction]);

const expectCondition = Type.Object({
    text: Type.Optional(Type.String({ maxLength: 512 })),
    role: Type.Optional(Type.String({ maxLength: 128 })),
    elementIndex: Type.Optional(elementIndex),
    until: Type.Optional(Type.Union([Type.Literal("present"), Type.Literal("absent")])),
    timeoutMs: Type.Optional(Type.Number({ minimum: 100, maximum: 60_000, description: "Default 10000ms" })),
});

const listAppsTool = defineTool({
    name: "list_apps",
    label: "List Apps",
    annotations: { readOnlyHint: true },
    namespace: { name: "computer_use", description: "Windows desktop observation and control" },
    description: "List running Windows apps and top-level windows.",
    promptSnippet: "Find a window.",
    parameters: Type.Object({
        app: Type.Optional(Type.String({ maxLength: 256, description: "Case-insensitive app name filter" })),
        title: Type.Optional(Type.String({ maxLength: 256, description: "Case-insensitive window title filter" })),
        pid: Type.Optional(Type.Number()),
        includeMinimized: Type.Optional(Type.Boolean({ description: "Default true" })),
        limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100, description: "Maximum windows, default 20" })),
    }),
    outputSchema: listAppsOutputSchema,
    execute: executeListApps,
});

const getWindowStateTool = defineTool({
    name: "get_window_state",
    label: "Get Window State",
    annotations: { readOnlyHint: true },
    namespace: { name: "computer_use", description: "Windows desktop observation and control" },
    description: "Observe a window. Return a stateId, folded UIA tree, and optional screenshot. With stateId, query or expand that state without recapturing.",
    promptSnippet: "Observe or query a window.",
    promptGuidelines: [
        "Prefer stateId + query or elementIndex over recapturing.",
        "Coordinates are window-relative screenshot pixels.",
    ],
    parameters: Type.Object({
        window: windowRef,
        stateId: Type.Optional(stateId),
        refresh: Type.Optional(Type.Boolean({ description: "Recapture even when stateId is supplied" })),
        includeText: Type.Optional(Type.Boolean({ description: "Default false. Implied by query or elementIndex" })),
        includeScreenshot: Type.Optional(Type.Boolean({ description: "Default true on capture, false when querying an existing stateId" })),
        screenshotData: Type.Optional(Type.Boolean({ description: "Include a data URL in structuredContent for codemode image()" })),
        query: Type.Optional(Type.Object({
            text: Type.Optional(Type.String({ maxLength: 256 })),
            role: Type.Optional(Type.String({ maxLength: 128 })),
            capability: Type.Optional(Type.String({ maxLength: 128 })),
            limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
        })),
        elementIndex: Type.Optional(elementIndex),
        depth: Type.Optional(Type.Number({ minimum: 1, maximum: 8, description: "Subtree depth, default 2" })),
    }),
    outputSchema: getWindowStateOutputSchema,
    execute: executeGetWindowState,
});

const actTool = defineTool({
    name: "act",
    label: "Act",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    namespace: { name: "computer_use", description: "Windows desktop observation and control" },
    description: "Execute a checked action transaction against a stateId. Returns an outcome and successor diff.",
    promptSnippet: "Act, then use the returned stateId.",
    promptGuidelines: [
        "Omit elementIndex from type_text or press_key to keep focus established by a preceding click.",
        "Use the successor stateId. Observe again only when outcome is unknown or view is full.",
    ],
    parameters: Type.Object({
        window: windowRef,
        stateId,
        actions: Type.Array(uiAction, { minItems: 1, maxItems: 20 }),
        expect: Type.Optional(expectCondition),
    }),
    outputSchema: actOutputSchema,
    execute: executeAct,
});

const waitForTool = defineTool({
    name: "wait_for",
    label: "Wait For",
    annotations: { readOnlyHint: true },
    namespace: { name: "computer_use", description: "Windows desktop observation and control" },
    description: "Wait for a UI condition and return a successor state.",
    promptSnippet: "Wait for a UI condition.",
    parameters: Type.Object({
        window: windowRef,
        stateId: Type.Optional(stateId),
        text: Type.Optional(Type.String({ maxLength: 512 })),
        role: Type.Optional(Type.String({ maxLength: 128 })),
        elementIndex: Type.Optional(elementIndex),
        until: Type.Optional(Type.Union([Type.Literal("present"), Type.Literal("absent")])),
        timeoutMs: Type.Optional(Type.Number({ minimum: 100, maximum: 60_000, description: "Default 10000ms" })),
    }),
    outputSchema: waitForOutputSchema,
    execute: executeWaitFor,
});

const launchAppTool = defineTool({
    name: "launch_app",
    label: "Launch App",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    namespace: { name: "computer_use", description: "Windows desktop observation and control" },
    description: "Launch an app, executable, shortcut, or URI and return its windows. No shell interpretation.",
    promptSnippet: "Launch an app.",
    promptGuidelines: ["Script files and terminal launchers are rejected."],
    parameters: Type.Object({
        app: Type.String({ maxLength: 2048, description: "App name, executable path, shortcut, or URI" }),
        args: Type.Optional(Type.Array(Type.String({ maxLength: 2048 }), { maxItems: 64 })),
        waitMs: Type.Optional(Type.Number({ minimum: 0, maximum: 30_000, description: "Default 10000ms" })),
    }),
    outputSchema: launchAppOutputSchema,
    execute: executeLaunchApp,
});

export default function computerUseExtension(pi: ExtensionAPI): void {
    for (const tool of [listAppsTool, getWindowStateTool, actTool, waitForTool, launchAppTool]) pi.registerTool(tool);

    pi.on("session_start", async (_event, ctx) => {
        loadComputerUseConfig(ctx.cwd);
        if (!ctx.hasUI) return;
        try { await ensureComputerUseSetup(ctx); } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning"); }
    });

    pi.on("session_shutdown", async () => {
        await shutdownComputerUseSession();
    });
}
