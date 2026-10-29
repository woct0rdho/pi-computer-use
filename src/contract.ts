export type WindowId = number | string;
export type MouseButton = "left" | "right" | "middle";
export type ActionOutcome = "worked" | "didnt" | "unknown";

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface WindowRef {
    app: string;
    id: WindowId;
    title?: string;
}

export interface WindowDetails extends WindowRef {
    kind?: "window" | "dialog" | "menu" | "popover";
    pid?: number;
    isForeground?: boolean;
    isMinimized?: boolean;
    bounds?: Rect;
}

export interface ListAppsParams {
    app?: string;
    title?: string;
    pid?: number;
    includeMinimized?: boolean;
    limit?: number;
}

export interface ListAppsResult {
    apps: Array<{
        app: string;
        name?: string;
        pid?: number;
        windows: WindowDetails[];
    }>;
    windows: WindowDetails[];
    total: number;
    returned: number;
}

export interface GetWindowStateParams {
    window: WindowRef;
    stateId?: string;
    refresh?: boolean;
    includeText?: boolean;
    includeScreenshot?: boolean;
    screenshotData?: boolean;
    query?: {
        text?: string;
        role?: string;
        capability?: string;
        limit?: number;
    };
    elementIndex?: number;
    depth?: number;
}

export interface AccessibilityView {
    tree: string;
    focusedElement?: string;
    selectedText?: string;
    selectedElements?: string[];
    documentText?: string;
    truncated?: boolean;
    nodeCount?: number;
    returned?: number;
}

export interface ScreenshotView {
    screenshotId: string;
    width: number;
    height: number;
    originX: number;
    originY: number;
    dataUrl?: string;
    coordinateGuidance?: string;
}

export interface WindowStateResult {
    stateId: string;
    window: WindowRef;
    accessibility: AccessibilityView | null;
    screenshots: ScreenshotView[];
    matches?: number;
    activation?: {
        activated: boolean;
        raised: boolean;
        unminimized: boolean;
    };
}

export interface ExpectCondition {
    text?: string;
    role?: string;
    elementIndex?: number;
    until?: "present" | "absent";
    timeoutMs?: number;
}

export interface ClickAction {
    type: "click";
    elementIndex?: number;
    x?: number;
    y?: number;
    screenshotId?: string;
    button?: MouseButton;
    count?: 1 | 2 | 3;
}

export interface TypeTextAction {
    type: "type_text";
    text: string;
    elementIndex?: number;
}

export interface PressKeyAction {
    type: "press_key";
    key: string;
    elementIndex?: number;
}

export interface SetValueAction {
    type: "set_value";
    elementIndex: number;
    value: string;
}

export interface ScrollAction {
    type: "scroll";
    elementIndex?: number;
    x?: number;
    y?: number;
    deltaX?: number;
    deltaY?: number;
    screenshotId?: string;
}

export interface DragAction {
    type: "drag";
    from: { x: number; y: number };
    to: { x: number; y: number };
    durationMs?: number;
    screenshotId?: string;
}

export interface ActivateAction {
    type: "activate";
}

export type UiAction = ClickAction | TypeTextAction | PressKeyAction | SetValueAction | ScrollAction | DragAction | ActivateAction;

export interface ActParams {
    window: WindowRef;
    stateId: string;
    actions: UiAction[];
    expect?: ExpectCondition;
}

export interface Verification {
    status: "verified" | "preexisting" | "failed";
    text?: string;
    role?: string;
    value?: string;
    gone?: boolean;
    timeoutMs: number;
}

export interface Change {
    type: "added" | "updated" | "removed";
    elementIndex: number;
    parentIndex?: number;
    path?: number[];
    fields?: Record<string, unknown>;
}

export interface ActResult {
    stateId?: string;
    window: WindowRef;
    outcome: ActionOutcome;
    verification?: Verification;
    view: "diff" | "full";
    changes?: Change[];
    accessibility?: AccessibilityView;
    screenshots?: ScreenshotView[];
    error?: { code: string; message: string };
    activation?: {
        activated: boolean;
        raised: boolean;
        unminimized: boolean;
    };
}

export interface WaitForParams {
    window: WindowRef;
    stateId?: string;
    text?: string;
    role?: string;
    elementIndex?: number;
    until?: "present" | "absent";
    timeoutMs?: number;
}

export interface WaitForResult {
    found: boolean;
    timedOut?: boolean;
    stateId: string;
    view: "diff" | "full";
    changes?: Change[];
    accessibility?: AccessibilityView;
    match?: {
        elementIndex: number;
        role: string;
        label: string;
    };
}

export interface LaunchAppParams {
    app: string;
    args?: string[];
    waitMs?: number;
}

export interface LaunchAppResult {
    launched: boolean;
    windows: WindowDetails[];
    error?: { code: string; message: string };
}
