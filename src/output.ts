import type { AgentToolResult } from "@earendil-works/pi-coding-agent";

export const MODEL_TEXT_MAX_BYTES = 48 * 1024;
export const MODEL_TEXT_MAX_LINES = 2_000;

function utf8Prefix(value: string, maxBytes: number): string {
    const bytes = new TextEncoder().encode(value);
    if (bytes.byteLength <= maxBytes) return value;
    let end = maxBytes;
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
    return new TextDecoder().decode(bytes.subarray(0, end));
}

function bounded(value: string, maxBytes = MODEL_TEXT_MAX_BYTES, maxLines = MODEL_TEXT_MAX_LINES): string {
    const lines = value.split("\n");
    const lineBound = lines.length > maxLines ? lines.slice(0, maxLines).join("\n") : value;
    return utf8Prefix(lineBound, maxBytes);
}

export function structuredContentFromDetails<T>(details: T): AgentToolResult<T>["structuredContent"] {
    if (!details || typeof details !== "object" || Array.isArray(details)) return undefined;
    return details as AgentToolResult<T>["structuredContent"];
}

export function applyOutputEnvelope<T>(tool: string, result: AgentToolResult<T>): AgentToolResult<T> {
    const textParts = result.content.filter((part): part is Extract<(typeof result.content)[number], { type: "text" }> => part.type === "text");
    const combined = textParts.map((part) => part.text).join("\n");
    const boundedText = bounded(combined);
    if (boundedText === combined) return result;
    const images = result.content.filter((part) => part.type === "image");
    const trailer = `\n\noutput truncated by ${tool}. Narrow the query or inspect a specific element_index.`;
    const trailerBytes = new TextEncoder().encode(trailer).byteLength;
    const body = bounded(combined, MODEL_TEXT_MAX_BYTES - trailerBytes, MODEL_TEXT_MAX_LINES - 2);
    return {
        ...result,
        content: [{ type: "text", text: `${body}${trailer}` }, ...images],
    };
}

export function boundToolError(tool: string, error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error);
    const boundedMessage = bounded(message, MODEL_TEXT_MAX_BYTES, MODEL_TEXT_MAX_LINES);
    if (boundedMessage === message) return error instanceof Error ? error : new Error(message);
    const trailer = `\n\nerror truncated by ${tool}. Retry with a narrower target.`;
    const trailerBytes = new TextEncoder().encode(trailer).byteLength;
    return new Error(`${bounded(message, MODEL_TEXT_MAX_BYTES - trailerBytes, MODEL_TEXT_MAX_LINES - 2)}${trailer}`);
}
