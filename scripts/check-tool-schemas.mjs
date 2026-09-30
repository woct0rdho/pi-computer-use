#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const files = ["extensions/computer-use.ts", "src/schemas.ts"];
const failures = [];

for (const file of files) {
  const path = join(root, file);
  const source = readFileSync(path, "utf8");

  const checks = [
    {
      name: "Type.Tuple",
      pattern: /Type\.Tuple\s*\(/,
      message: "Type.Tuple emits array-form JSON Schema items, which some function-call validators reject.",
    },
    {
      name: "array-form items",
      pattern: /\bitems\s*:\s*\[/,
      message: "JSON Schema items must be an object or boolean for function-call compatibility.",
    },
    {
      name: "prefixItems",
      pattern: /\bprefixItems\b/,
      message: "Tuple-style prefixItems is not accepted by all function-call schema validators.",
    },
  ];

  for (const check of checks) {
    if (check.pattern.test(source)) {
      failures.push(`${file}: ${check.name}: ${check.message}`);
    }
  }
}

if (failures.length) {
  console.error("Tool schema compatibility checks failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

// Runtime registration checks: load the extension with a stub API and verify
// that every registered tool declares portable input and output schemas.
const tools = [];
const stub = {
  registerTool: (tool) => tools.push(tool),
  registerCommand: () => {},
  on: () => {},
};
const { default: computerUseExtension } = await import("../extensions/computer-use.ts");
computerUseExtension(stub);

const expected = ["find_roots", "observe_ui", "search_ui", "expand_ui", "inspect_ui", "act_ui", "read_text", "wait_for"];
assert.deepEqual(tools.map((tool) => tool.name), expected, "registered tool surface drifted");
for (const tool of tools) {
  assert.ok(tool.parameters && typeof tool.parameters === "object", `${tool.name} has no parameters schema`);
  assert.ok(tool.outputSchema && typeof tool.outputSchema === "object", `${tool.name} has no output schema`);
  assert.ok(tool.annotations && typeof tool.annotations === "object", `${tool.name} has no annotations`);
  const json = JSON.stringify({ parameters: tool.parameters, outputSchema: tool.outputSchema });
  for (const [label, pattern] of [
    ["prefixItems", /"prefixItems"/],
    ["array-form items", /"items":\s*\[/],
  ]) {
    assert.ok(!pattern.test(json), `${tool.name} ${label} is not function-call compatible`);
  }
}
const act = tools.find((tool) => tool.name === "act_ui");
assert.equal(act?.annotations?.readOnlyHint, false, "act_ui must not be marked read-only");
assert.equal(act?.annotations?.destructiveHint, true, "act_ui must be marked destructive");
for (const tool of tools) {
  if (tool.name === "act_ui") continue;
  assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} must be marked read-only`);
}

console.log("Tool schema compatibility checks passed.");
