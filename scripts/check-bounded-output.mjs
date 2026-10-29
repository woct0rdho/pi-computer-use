import assert from "node:assert/strict";
import { applyOutputEnvelope, boundToolError, MODEL_TEXT_MAX_BYTES, structuredContentFromDetails } from "../src/output.ts";
import { searchOutlineRanked } from "../src/outline.ts";

const oversized = "🙂".repeat(30_000);
const bounded = applyOutputEnvelope("get_window_state", { content: [{ type: "text", text: oversized }], details: {} });
const visible = bounded.content[0].text;
assert.ok(Buffer.byteLength(visible, "utf8") <= MODEL_TEXT_MAX_BYTES, "model-facing text exceeds the hard ceiling");
assert.match(visible, /output truncated by get_window_state/, "truncated output must tell the model how to recover");
const lineBounded = applyOutputEnvelope("get_window_state", { content: [{ type: "text", text: "x\n".repeat(3_000) }], details: {} });
assert.ok(lineBounded.content[0].text.split("\n").length <= 2_001, "model-facing text exceeds the line ceiling");
const boundedError = boundToolError("act", new Error("x".repeat(100_000)));
assert.ok(Buffer.byteLength(boundedError.message, "utf8") <= MODEL_TEXT_MAX_BYTES, "tool errors must obey the text ceiling");

const details = { stateId: "s1", window: { app: "Notepad", id: 1 } };
assert.equal(structuredContentFromDetails(details), details, "structured details must pass through unchanged");
assert.equal(structuredContentFromDetails(undefined), undefined, "undefined details must not project");
assert.equal(structuredContentFromDetails([1, 2]), undefined, "array details must not project");

const node = (ref, title, role = "button") => ({ ref, role, subrole: "", identifier: "", title, description: "", value: "", actions: [], canPress: true, canFocus: false, canSetValue: false, canScroll: false, canIncrement: false, canDecrement: false, isTextInput: false, focused: false, offscreen: false, pictureOnly: false, truncated: false, text: [], children: [] });
const root = node("@e1", "root", "window");
root.children = [node("@e2", "Save"), node("@e3", "Save changes"), node("@e4", "Autosave"), node("@e5", "Svae")];
for (const child of root.children) child.parent = root;
const outline = { lookId: "look", root, nodes: [root, ...root.children], refToWireRef: new Map(), wireRefToRef: new Map() };
const ranked = searchOutlineRanked(outline, "save", "button", "press", 12);
assert.deepEqual(ranked.matches.map((match) => match.matchReason), ["exact", "prefix", "substring", "fuzzy"]);
assert.equal(ranked.totalMatches, 4);

console.log("Bounded output and ranked search checks passed.");
