import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface ComputerUseConfig {
    headless: boolean;
}

const DEFAULT_CONFIG: ComputerUseConfig = {
    headless: false,
};

let activeConfig: ComputerUseConfig = { ...DEFAULT_CONFIG };

function parseBoolean(value: unknown): boolean | undefined {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value === 1 ? true : value === 0 ? false : undefined;
    if (typeof value !== "string") return undefined;
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
    if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
    return undefined;
}

function readConfigFile(filePath: string): Partial<ComputerUseConfig> {
    if (!existsSync(filePath)) return {};
    try {
        const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        const headless = parseBoolean((parsed as Record<string, unknown>).headless);
        return headless === undefined ? {} : { headless };
    } catch (error) {
        throw new Error(`Invalid pi-computer-use config at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function readEnv(): Partial<ComputerUseConfig> {
    const headless = parseBoolean(process.env.PI_COMPUTER_USE_HEADLESS);
    return headless === undefined ? {} : { headless };
}

export function loadComputerUseConfig(cwd: string): void {
    const config = { ...DEFAULT_CONFIG };
    Object.assign(config, readConfigFile(path.join(getAgentDir(), "extensions", "pi-computer-use.json")));
    Object.assign(config, readConfigFile(path.join(cwd, ".pi", "computer-use.json")));
    Object.assign(config, readEnv());
    activeConfig = config;
}

export function getComputerUseConfig(): ComputerUseConfig {
    return activeConfig;
}

export function isHeadlessMode(): boolean {
    return activeConfig.headless;
}
