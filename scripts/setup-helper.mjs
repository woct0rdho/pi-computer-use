#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants, realpathSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const windowsCrateDir = path.join(rootDir, "native", "windows", "bridge-rs");
const prebuiltHelperPath = path.join(rootDir, "prebuilt", "windows", "windows-bridge.exe");
const windowsHelperDestPath = process.env.PI_COMPUTER_USE_WINDOWS_HELPER_PATH || path.join(os.homedir(), ".pi", "agent", "helpers", "pi-computer-use", "windows-bridge.exe");

const args = new Set(process.argv.slice(2));
const isPostinstall = args.has("--postinstall");
const allowBuildFallback = args.has("--allow-build") || args.has("--runtime") || process.env.PI_COMPUTER_USE_ALLOW_BUILD === "1";

async function exists(filePath) {
	try {
		await fs.access(filePath, fsConstants.F_OK);
		return true;
	} catch {
		return false;
	}
}

async function hashFile(filePath) {
	const data = await fs.readFile(filePath);
	return createHash("sha256").update(data).digest("hex");
}

async function copyIfChanged(sourcePath, destinationPath) {
	const destinationExists = await exists(destinationPath);
	if (destinationExists) {
		const [sourceHash, destinationHash] = await Promise.all([hashFile(sourcePath), hashFile(destinationPath)]);
		if (sourceHash === destinationHash) {
			await fs.chmod(destinationPath, 0o755);
			return { changed: false };
		}
	}

	await fs.mkdir(path.dirname(destinationPath), { recursive: true });
	const tempPath = `${destinationPath}.tmp-${process.pid}-${Date.now()}`;
	await fs.copyFile(sourcePath, tempPath);
	await fs.chmod(tempPath, 0o755);
	try {
		await fs.rename(tempPath, destinationPath);
	} catch (err) {
		await fs.rm(tempPath, { force: true }).catch(() => {});
		if (err.code === "EPERM") {
			throw new Error(`Cannot update helper at ${destinationPath} — the existing helper process is still running. Close the helper process and re-run this script.`);
		}
		throw err;
	}
	return { changed: true };
}

async function run(command, commandArgs) {
	await new Promise((resolve, reject) => {
		const child = spawn(command, commandArgs, { stdio: "inherit" });
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`Command failed (${code}): ${command} ${commandArgs.join(" ")}`));
		});
	});
}

async function setupWindowsHelper() {
	if (await exists(prebuiltHelperPath)) {
		const { changed } = await copyIfChanged(prebuiltHelperPath, windowsHelperDestPath);
		console.log(changed
			? `[pi-computer-use] installed Windows helper from prebuilt to ${windowsHelperDestPath}`
			: `[pi-computer-use] Windows helper already up to date at ${windowsHelperDestPath}`);
		return;
	}

	if (allowBuildFallback) {
		console.log("[pi-computer-use] Windows prebuilt helper missing; attempting source build with cargo...");
		await run("cargo", ["build", "--release", "--manifest-path", path.join(windowsCrateDir, "Cargo.toml")]);
		const cargoOutput = path.join(windowsCrateDir, "target", "release", "windows-bridge.exe");
		const { changed } = await copyIfChanged(cargoOutput, windowsHelperDestPath);
		console.log(changed
			? `[pi-computer-use] built and installed Windows helper at ${windowsHelperDestPath}`
			: `[pi-computer-use] Windows helper already up to date at ${windowsHelperDestPath}`);
		return;
	}

	throw new Error(
		`No Windows prebuilt helper found at ${prebuiltHelperPath}. ` +
			"Run 'node scripts/build-native.mjs' to build, or set PI_COMPUTER_USE_ALLOW_BUILD=1 to build at install time.",
	);
}

async function setup() {
	if (process.platform !== "win32") {
		throw new Error("pi-computer-use is only supported on Windows.");
	}
	await setupWindowsHelper();
}

const isMain = process.argv[1] && realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) setup().catch((error) => {
	if (isPostinstall) {
		console.warn(`[pi-computer-use] postinstall helper setup skipped: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(0);
	}

	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
