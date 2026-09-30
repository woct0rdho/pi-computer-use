/**
 * TypeBox schemas for the `structuredContent` of each tool.
 *
 * The machine-facing result is `details` without the rendered outline text, so
 * scripts and other programmatic callers get data instead of a formatted
 * string. Deep structures that are already documented by the `details`
 * interfaces (outlines, notes, diagnostics) stay `unknown` here: codemode
 * renders output schemas in full, so the envelope fields scripts actually use
 * are typed and the rest remains honest.
 */
import { Type } from "typebox";

const rectSchema = Type.Object({
	x: Type.Number(),
	y: Type.Number(),
	w: Type.Number(),
	h: Type.Number(),
});

const targetSchema = Type.Object({
	app: Type.String(),
	pid: Type.Number(),
	windowTitle: Type.String(),
	windowId: Type.Number(),
	windowRef: Type.Optional(Type.String()),
	nativeWindowRef: Type.Optional(Type.String()),
});

const captureSchema = Type.Object({
	stateId: Type.String(),
	width: Type.Number(),
	height: Type.Number(),
	scaleFactor: Type.Number(),
	timestamp: Type.Number(),
	coordinateSpace: Type.Literal("window-relative-screenshot-pixels"),
});

const executionVariantSchema = Type.Union([Type.Literal("stealth"), Type.Literal("default")]);
const viewSchema = Type.Union([Type.Literal("full"), Type.Literal("diff")]);

const executionSchema = Type.Object({
	strategy: Type.Union([Type.Literal("look"), Type.Literal("act"), Type.Literal("wait")]),
	runtimeMode: Type.Optional(executionVariantSchema),
	variant: Type.Optional(executionVariantSchema),
	stealthCompatible: Type.Optional(Type.Boolean()),
	delivery: Type.Optional(Type.Union([Type.Literal("ax"), Type.Literal("hid")])),
	deliveryPolicy: Type.Optional(Type.Union([Type.Literal("ax_only"), Type.Literal("background"), Type.Literal("default"), Type.Literal("foreground")])),
	outcome: Type.Optional(Type.Union([Type.Literal("worked"), Type.Literal("didnt"), Type.Literal("unknown")])),
	actionCount: Type.Optional(Type.Number()),
	stoppedAt: Type.Optional(Type.Number()),
	backgroundFirst: Type.Optional(Type.Boolean()),
	escalatedToForeground: Type.Optional(Type.Boolean()),
	escalationReason: Type.Optional(Type.String()),
	verification: Type.Optional(
		Type.Object({
			status: Type.Union([Type.Literal("verified"), Type.Literal("preexisting"), Type.Literal("failed")]),
			text: Type.Optional(Type.String()),
			role: Type.Optional(Type.String()),
			value: Type.Optional(Type.String()),
			gone: Type.Optional(Type.Boolean()),
			timeoutMs: Type.Number(),
		}),
	),
	performed: Type.Optional(Type.Unknown()),
	evidence: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	error: Type.Optional(Type.Unknown()),
	rootDelta: Type.Optional(Type.Unknown()),
	steps: Type.Optional(Type.Array(Type.Unknown())),
	backgroundAttempt: Type.Optional(Type.Unknown()),
});

const activationSchema = Type.Object({
	activated: Type.Boolean(),
	unminimized: Type.Boolean(),
	raised: Type.Boolean(),
});

const configSchema = Type.Object({ headless: Type.Boolean() });

const imageReasonSchema = Type.Union([
	Type.Literal("fallback_recovery"),
	Type.Literal("no_ax_targets"),
	Type.Literal("sparse_ax_targets"),
	Type.Literal("weak_ax_targets"),
	Type.Literal("unlabeled_ax_targets"),
	Type.Literal("duplicated_ax_labels"),
]);

const viewReasonSchema = Type.Union([
	Type.Literal("root_replaced"),
	Type.Literal("change_budget_exceeded"),
	Type.Literal("identity_confidence_low"),
]);

const matchSummarySchema = Type.Object({
	ref: Type.String(),
	role: Type.String(),
	label: Type.String(),
	actions: Type.Array(Type.String()),
	path: Type.String(),
	matchReason: Type.Optional(Type.Union([Type.Literal("exact"), Type.Literal("prefix"), Type.Literal("substring"), Type.Literal("fuzzy"), Type.Literal("filter")])),
	score: Type.Optional(Type.Number()),
});

export const findRootsOutputSchema = Type.Object({
	tool: Type.Literal("find_roots"),
	query: Type.Object({
		text: Type.Optional(Type.String()),
		app: Type.Optional(Type.String()),
		pid: Type.Optional(Type.Number()),
		kind: Type.Optional(Type.Union([Type.Literal("window"), Type.Literal("menu"), Type.Literal("popover"), Type.Literal("dialog")])),
	}),
	totalMatches: Type.Optional(Type.Number()),
	returned: Type.Optional(Type.Number()),
	hasMore: Type.Optional(Type.Boolean()),
	windows: Type.Array(
		Type.Object({
			app: Type.String(),
			pid: Type.Number(),
			kind: Type.String(),
			windowTitle: Type.String(),
			windowId: Type.Optional(Type.Number()),
			windowRef: Type.String(),
			nativeWindowRef: Type.Optional(Type.String()),
			framePoints: rectSchema,
			scaleFactor: Type.Number(),
			isMinimized: Type.Boolean(),
			isOnscreen: Type.Boolean(),
			isMain: Type.Boolean(),
			isFocused: Type.Boolean(),
			isModal: Type.Boolean(),
			role: Type.Optional(Type.String()),
			subrole: Type.Optional(Type.String()),
			zOrder: Type.Number(),
			score: Type.Number(),
		}),
	),
	config: configSchema,
});

const computerUseSchema = Type.Object({
	tool: Type.String(),
	target: targetSchema,
	capture: captureSchema,
	lookId: Type.Optional(Type.String()),
	view: viewSchema,
	baseStateId: Type.Optional(Type.String()),
	changes: Type.Optional(Type.Unknown()),
	viewReason: Type.Optional(viewReasonSchema),
	outline: Type.Optional(Type.Unknown()),
	note: Type.Optional(Type.Unknown()),
	activation: activationSchema,
	execution: executionSchema,
	config: Type.Optional(configSchema),
	helper: Type.Optional(Type.Unknown()),
	status: Type.Optional(Type.Literal("ok")),
	axDiagnostics: Type.Optional(Type.Unknown()),
	imageReason: Type.Optional(imageReasonSchema),
});

const terminalDesktopActionSchema = Type.Object({
	tool: Type.Literal("act_ui"),
	status: Type.Union([Type.Literal("target_closed"), Type.Literal("post_action_observation_failed")]),
	baseStateId: Type.String(),
	target: targetSchema,
	execution: executionSchema,
	error: Type.Object({ code: Type.String(), message: Type.String() }),
});

export const observeUiOutputSchema = computerUseSchema;
export const actUiOutputSchema = Type.Union([computerUseSchema, terminalDesktopActionSchema]);

const outlineToolSchema = Type.Object({
	tool: Type.Union([Type.Literal("search_ui"), Type.Literal("expand_ui"), Type.Literal("inspect_ui")]),
	stateId: Type.Optional(Type.String()),
	lookId: Type.Optional(Type.String()),
	outline: Type.Optional(Type.Unknown()),
	totalMatches: Type.Optional(Type.Number()),
	returned: Type.Optional(Type.Number()),
	hasMore: Type.Optional(Type.Boolean()),
	matches: Type.Optional(Type.Array(matchSummarySchema)),
	target: Type.Optional(Type.Unknown()),
	note: Type.Optional(Type.Unknown()),
});

export const searchUiOutputSchema = outlineToolSchema;
export const expandUiOutputSchema = outlineToolSchema;
export const inspectUiOutputSchema = outlineToolSchema;

export const readTextOutputSchema = Type.Object({
	tool: Type.Literal("read_text"),
	ref: Type.Optional(Type.String()),
	offset: Type.Number(),
	limit: Type.Number(),
	totalChars: Type.Optional(Type.Number()),
	totalBytes: Type.Optional(Type.Number()),
	hasMore: Type.Boolean(),
	complete: Type.Optional(Type.Boolean()),
	text: Type.String(),
});

export const waitForOutputSchema = Type.Object({
	tool: Type.Literal("wait_for"),
	stateId: Type.String(),
	baseStateId: Type.Optional(Type.String()),
	view: viewSchema,
	changes: Type.Optional(Type.Unknown()),
	found: Type.Boolean(),
	gone: Type.Optional(Type.Boolean()),
	timedOut: Type.Optional(Type.Boolean()),
	target: Type.Optional(matchSummarySchema),
	nodeCount: Type.Optional(Type.Number()),
	text: Type.Optional(Type.String()),
	role: Type.Optional(Type.String()),
	value: Type.Optional(Type.String()),
	scopeRef: Type.Optional(Type.String()),
	outline: Type.Unknown(),
});
