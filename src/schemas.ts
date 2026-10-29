import { Type } from "typebox";

const rectSchema = Type.Object({
    x: Type.Number(),
    y: Type.Number(),
    w: Type.Number(),
    h: Type.Number(),
});

const windowSchema = Type.Object({
    app: Type.String(),
    id: Type.Union([Type.Number(), Type.String()]),
    title: Type.Optional(Type.String()),
    kind: Type.Optional(Type.Union([Type.Literal("window"), Type.Literal("dialog"), Type.Literal("menu"), Type.Literal("popover")])),
    pid: Type.Optional(Type.Number()),
    isForeground: Type.Optional(Type.Boolean()),
    isMinimized: Type.Optional(Type.Boolean()),
    bounds: Type.Optional(rectSchema),
});

const accessibilitySchema = Type.Object({
    tree: Type.String(),
    focusedElement: Type.Optional(Type.String()),
    selectedText: Type.Optional(Type.String()),
    selectedElements: Type.Optional(Type.Array(Type.String())),
    documentText: Type.Optional(Type.String()),
    truncated: Type.Optional(Type.Boolean()),
    nodeCount: Type.Optional(Type.Number()),
    returned: Type.Optional(Type.Number()),
});

const screenshotSchema = Type.Object({
    screenshotId: Type.String(),
    width: Type.Number(),
    height: Type.Number(),
    originX: Type.Number(),
    originY: Type.Number(),
    dataUrl: Type.Optional(Type.String()),
    coordinateGuidance: Type.Optional(Type.String()),
});

const activationSchema = Type.Object({
    activated: Type.Boolean(),
    raised: Type.Boolean(),
    unminimized: Type.Boolean(),
});

const changeSchema = Type.Object({
    type: Type.Union([Type.Literal("added"), Type.Literal("updated"), Type.Literal("removed")]),
    elementIndex: Type.Number(),
    parentIndex: Type.Optional(Type.Number()),
    path: Type.Optional(Type.Array(Type.Number())),
    fields: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

const verificationSchema = Type.Object({
    status: Type.Union([Type.Literal("verified"), Type.Literal("preexisting"), Type.Literal("failed")]),
    text: Type.Optional(Type.String()),
    role: Type.Optional(Type.String()),
    value: Type.Optional(Type.String()),
    gone: Type.Optional(Type.Boolean()),
    timeoutMs: Type.Number(),
});

const errorSchema = Type.Object({
    code: Type.String(),
    message: Type.String(),
});

export const listAppsOutputSchema = Type.Object({
    apps: Type.Array(Type.Object({
        app: Type.String(),
        name: Type.Optional(Type.String()),
        pid: Type.Optional(Type.Number()),
        windows: Type.Array(windowSchema),
    })),
    windows: Type.Array(windowSchema),
    total: Type.Number(),
    returned: Type.Number(),
});

export const getWindowStateOutputSchema = Type.Object({
    stateId: Type.String(),
    window: windowSchema,
    accessibility: Type.Union([accessibilitySchema, Type.Null()]),
    screenshots: Type.Array(screenshotSchema),
    matches: Type.Optional(Type.Number()),
    activation: Type.Optional(activationSchema),
});

export const actOutputSchema = Type.Object({
    stateId: Type.Optional(Type.String()),
    window: windowSchema,
    outcome: Type.Union([Type.Literal("worked"), Type.Literal("didnt"), Type.Literal("unknown")]),
    verification: Type.Optional(verificationSchema),
    view: Type.Union([Type.Literal("diff"), Type.Literal("full")]),
    changes: Type.Optional(Type.Array(changeSchema)),
    accessibility: Type.Optional(accessibilitySchema),
    screenshots: Type.Optional(Type.Array(screenshotSchema)),
    nextWindows: Type.Optional(Type.Array(windowSchema)),
    error: Type.Optional(errorSchema),
    activation: Type.Optional(activationSchema),
});

export const waitForOutputSchema = Type.Object({
    found: Type.Boolean(),
    timedOut: Type.Optional(Type.Boolean()),
    stateId: Type.String,
    view: Type.Union([Type.Literal("diff"), Type.Literal("full")]),
    changes: Type.Optional(Type.Array(changeSchema)),
    accessibility: Type.Optional(accessibilitySchema),
    match: Type.Optional(Type.Object({
        elementIndex: Type.Number(),
        role: Type.String(),
        label: Type.String(),
    })),
});

export const launchAppOutputSchema = Type.Object({
    launched: Type.Boolean(),
    windows: Type.Array(windowSchema),
    error: Type.Optional(errorSchema),
});
