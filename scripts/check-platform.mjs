#!/usr/bin/env node
import assert from "node:assert/strict";
import { assertPlatformArchitecture, PLATFORM_ARCHITECTURE_VERSION, REQUIRED_PLATFORM_INVARIANTS } from "../src/platform/architecture.ts";

const helperOverride = "C:/tmp/custom-windows-bridge.exe";
process.env.PI_COMPUTER_USE_WINDOWS_HELPER_PATH = helperOverride;
const [{ currentPlatformBackend }, { WINDOWS_HELPER_PATH }] = await Promise.all([
	import("../src/platform/index.ts"),
	import("../src/platform/windows/helper.ts"),
]);

assert.equal(WINDOWS_HELPER_PATH, helperOverride);

assert.equal(currentPlatformBackend.name, "windows");
assert.equal(typeof currentPlatformBackend.ensureReady, "function");
assert.equal(typeof currentPlatformBackend.listApps, "function");
assert.equal(typeof currentPlatformBackend.listRoots, "function");
assert.equal(typeof currentPlatformBackend.observe, "function");
assert.equal(typeof currentPlatformBackend.act, "function");
assert.equal(typeof currentPlatformBackend.actBatch, "function");

const conforming = {
	protocolVersion: 1,
	pid: 1,
	architectureVersion: PLATFORM_ARCHITECTURE_VERSION,
	invariants: [...REQUIRED_PLATFORM_INVARIANTS],
};
assert.doesNotThrow(() => assertPlatformArchitecture("fixture", conforming));
assert.throws(
	() => assertPlatformArchitecture("fixture", { ...conforming, invariants: conforming.invariants.slice(1) }),
	/shared computer-use contract/,
);

console.log("platform checks passed");
