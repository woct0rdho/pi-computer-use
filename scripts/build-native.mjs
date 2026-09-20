#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const windowsCrateDir = path.join(rootDir, "native", "windows", "bridge-rs");
const defaultOutputPath = path.join(rootDir, "prebuilt", "windows", "windows-bridge.exe");

function getArg(name) {
	const index = process.argv.indexOf(name);
	if (index >= 0 && index + 1 < process.argv.length) {
		return process.argv[index + 1];
	}
	return undefined;
}

async function run(command, args) {
	await new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: "inherit" });
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`Command failed (${code}): ${command} ${args.join(" ")}`));
		});
	});
}

async function buildWindowsHelper(outputPath) {
	if (process.platform !== "win32") {
		throw new Error("The Windows helper must be built on Windows.");
	}

	console.log("Building Windows helper with cargo...");
	await run("cargo", ["build", "--release", "--manifest-path", path.join(windowsCrateDir, "Cargo.toml")]);

	const cargoOutput = path.join(windowsCrateDir, "target", "release", "windows-bridge.exe");
	const handle = await fs.open(cargoOutput, "r");
	try {
		const signature = Buffer.alloc(2);
		await handle.read(signature, 0, 2, 0);
		if (signature.toString("ascii") !== "MZ") {
			throw new Error(`Cargo output is not a Windows PE executable: ${cargoOutput}`);
		}
	} finally {
		await handle.close();
	}

	const destination = outputPath ? path.resolve(process.cwd(), outputPath) : defaultOutputPath;
	await fs.mkdir(path.dirname(destination), { recursive: true });
	await fs.copyFile(cargoOutput, destination);
	console.log(`Built Windows helper at ${destination}`);
}

buildWindowsHelper(getArg("--output")).catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
