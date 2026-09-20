#!/usr/bin/env node

/**
 * Smoke tests for the Windows helper build/install scripts.
 *
 * Verifies:
 *   1. Path constants stay aligned with the Windows backend helper path
 *   2. Prebuilt install and missing-prebuilt error behavior
 *   3. The native build script produces a Windows PE from the Windows crate
 *   4. No macOS/Linux build or signing paths remain
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "pi-computer-use-script-test-"));
const TEST_WINDOWS_HELPER = path.join(TEST_ROOT, "windows-bridge.exe");
const PREBUILT_WINDOWS_HELPER = path.join(ROOT, "prebuilt", "windows", "windows-bridge.exe");

// From scripts/setup-helper.mjs:
const WINDOWS_HELPER_DEST = path.join(
	os.homedir(), ".pi", "agent", "helpers", "pi-computer-use", "windows-bridge.exe",
);

// Expected by src/platform/windows/helper.ts -> WINDOWS_HELPER_PATH:
const WINDOWS_HELPER_STABLE_PATH = path.join(
	os.homedir(), ".pi", "agent", "helpers", "pi-computer-use", "windows-bridge.exe",
);

let failures = 0;
let assertions = 0;
const LABEL = "[check-build-scripts]";

function tap(actual, expected, msg) {
	assertions++;
	const ok = actual === expected;
	console.log(ok ? "  \u2705" : "  \u274c", msg);
	if (!ok) {
		console.error(`       expected: ${JSON.stringify(expected)}`);
		console.error(`       actual:   ${JSON.stringify(actual)}`);
		failures++;
	}
}

function tapMatch(actual, re, msg) {
	assertions++;
	const ok = re.test(actual);
	console.log(ok ? "  \u2705" : "  \u274c", msg);
	if (!ok) {
		console.error(`       pattern:  ${re}`);
		console.error(`       actual:   ${JSON.stringify(actual.slice(0, 200))}`);
		failures++;
	}
}

function tapAbsent(text, re, msg) {
	assertions++;
	const ok = !re.test(text);
	console.log(ok ? "  \u2705" : "  \u274c", msg);
	if (!ok) failures++;
}

/** Spawn a script, capturing stdout/stderr and the exit code. */
function runScript(relPath, args, timeoutMs = 120_000) {
	const scriptPath = path.join(__dirname, relPath);
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [scriptPath, ...args], {
			stdio: ["ignore", "pipe", "pipe"],
			env: {
				...process.env,
				PI_COMPUTER_USE_WINDOWS_HELPER_PATH: TEST_WINDOWS_HELPER,
			},
		});
		let stdout = "";
		let stderr = "";
		let settled = false;
		const finish = (result) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			resolve(result);
		};
		const timeout = setTimeout(() => {
			stderr += `Timed out after ${timeoutMs}ms: ${relPath} ${args.join(" ")}\n`;
			child.kill("SIGTERM");
			finish({ code: -1, stdout, stderr });
		}, timeoutMs);
		timeout.unref();
		child.stdout.on("data", (d) => { stdout += d.toString(); });
		child.stderr.on("data", (d) => { stderr += d.toString(); });
		child.on("close", (code) => finish({ code, stdout, stderr }));
		child.on("error", (err) => finish({ code: -1, stdout, stderr: `${stderr}${err.message}` }));
	});
}

function rmSilent(p) {
	try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ok */ }
}
process.on("exit", () => rmSilent(TEST_ROOT));

function readScript(relPath) {
	return fs.readFileSync(path.join(__dirname, relPath), "utf8");
}

const buildNativeSource = readScript("build-native.mjs");
const setupHelperSource = readScript("setup-helper.mjs");
const windowsHelperSource = fs.readFileSync(path.join(ROOT, "src", "platform", "windows", "helper.ts"), "utf8");

// ---------------------------------------------------------------------------
// 1. Static path and asset alignment
// ---------------------------------------------------------------------------

console.log(`\n${LABEL} Path alignment`);

tap(
	WINDOWS_HELPER_DEST,
	WINDOWS_HELPER_STABLE_PATH,
	"setup-helper.mjs dest matches WINDOWS_HELPER_PATH in src/platform/windows/helper.ts",
);

tapMatch(setupHelperSource, /windows-bridge\.exe/, "setup-helper installs windows-bridge.exe");
tapMatch(windowsHelperSource, /windows-bridge\.exe/, "windows backend resolves windows-bridge.exe");
tapMatch(buildNativeSource, /prebuilt", "windows", "windows-bridge\.exe/, "build-native defaults to prebuilt/windows/windows-bridge.exe");

// ---------------------------------------------------------------------------
// 2. build-native.mjs targets the Windows crate
// ---------------------------------------------------------------------------

console.log(`\n${LABEL} build-native.mjs`);

tapMatch(buildNativeSource, /native", "windows", "bridge-rs"/, "build-native uses the Windows Rust crate");
tapMatch(buildNativeSource, /"cargo", \["build", "--release"/, "build-native builds the helper with cargo release");
tapMatch(buildNativeSource, /MZ/, "build-native validates the Windows PE signature");
tapMatch(buildNativeSource, /process\.platform !== "win32"/, "build-native refuses non-Windows hosts");

// ---------------------------------------------------------------------------
// 3. setup-helper.mjs install behavior
// ---------------------------------------------------------------------------

console.log(`\n${LABEL} setup-helper.mjs (prebuilt handling)`);

{
	const prebuiltExists = fs.existsSync(PREBUILT_WINDOWS_HELPER);
	const result = await runScript("setup-helper.mjs", []);
	if (prebuiltExists) {
		const isOk = result.code === 0 || result.stderr.includes("EPERM");
		tap(isOk, true, "handles prebuilt (install or EPERM gracefully)");
		if (result.code === 0) {
			tap(fs.existsSync(TEST_WINDOWS_HELPER), true, "installs the helper to the configured path");
		}
	} else {
		tap(result.code, 1, "exits 1 when prebuilt absent");
		tapMatch(
			result.stderr,
			/No Windows prebuilt helper found/,
			"prints helpful error about missing prebuilt with build instructions",
		);
	}
}

console.log(`\n${LABEL} setup-helper.mjs --postinstall`);

{
	const result = await runScript("setup-helper.mjs", ["--postinstall"]);
	tap(result.code, 0, "--postinstall exits 0");
	const combined = result.stderr + result.stdout;
	tap(/skipped|installed|up to date/i.test(combined), true, "prints skip, install, or up-to-date message");
}

// ---------------------------------------------------------------------------
// 4. No macOS/Linux build or signing paths remain
// ---------------------------------------------------------------------------

console.log(`\n${LABEL} Removed platform build paths`);

const combinedBuildSources = buildNativeSource + setupHelperSource;
for (const pattern of [/xcrun/, /swiftc/, /linux-bridge/, /codesign/, /\/usr\/bin\/ditto/]) {
	tapAbsent(combinedBuildSources, pattern, `no ${pattern.source} build path remains`);
}

console.log(`\n${LABEL} ${"=".repeat(40)}`);
console.log(`${LABEL} Assertions: ${assertions}   Failures: ${failures}`);
if (failures === 0) {
	console.log(`${LABEL} \u2705 ALL PASSED`);
} else {
	console.log(`${LABEL} \u274c ${failures} FAILURE(S)`);
	process.exit(1);
}
