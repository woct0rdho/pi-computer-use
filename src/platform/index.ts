import { windowsBackend } from "./windows/backend.ts";

if (process.platform !== "win32") {
	throw new Error(`pi-computer-use only supports Windows (win32). Got platform '${process.platform}'.`);
}

export const currentPlatformBackend = windowsBackend;
