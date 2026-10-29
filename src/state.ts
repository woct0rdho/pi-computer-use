import { AsyncLocalStorage } from "node:async_hooks";
import { restoreOutline, serializeOutline, type LookResponse, type Outline, type SerializedOutline } from "./outline.ts";
import { StateStore, type StoredState } from "./runtime.ts";

export interface CurrentTarget {
    appName: string;
    pid: number;
    windowTitle: string;
    windowId: number;
    nativeWindowRef?: string;
    kind?: string;
    framePoints?: { x: number; y: number; w: number; h: number };
    scaleFactor?: number;
    isMinimized?: boolean;
    isOnscreen?: boolean;
    isFocused?: boolean;
}

export interface CurrentCapture {
    stateId: string;
    width: number;
    height: number;
    scaleFactor: number;
    timestamp: number;
}

export interface OperationState {
    currentTarget?: CurrentTarget;
    currentCapture?: CurrentCapture;
    currentLook?: LookResponse;
    currentOutline?: Outline;
    resourceKey?: string;
    epoch?: number;
}

interface DesktopObservation {
    kind: "desktop";
    target: CurrentTarget;
    capture: CurrentCapture;
    look: Omit<LookResponse, "parsedOutline" | "outline">;
    outline: SerializedOutline;
}

export type UiObservation = DesktopObservation;

export class SavedStates {
    readonly store = new StateStore<UiObservation>(128);
    readonly operations = new AsyncLocalStorage<OperationState>();

    current(): OperationState {
        const state = this.operations.getStore();
        if (!state) throw new Error("Computer-use operation state is unavailable.");
        return state;
    }

    get(stateId: string): StoredState<UiObservation> | undefined {
        return this.store.get(stateId);
    }

    set(record: StoredState<UiObservation>): void {
        this.store.set(record);
    }

    clear(): void {
        this.store.clear();
    }

    hydrate(record: StoredState<UiObservation> | undefined): OperationState {
        if (!record) return {};
        const outline = restoreOutline(record.value.outline);
        return {
            currentTarget: { ...record.value.target },
            currentCapture: { ...record.value.capture },
            currentLook: { ...record.value.look, outline: outline.root, parsedOutline: outline },
            currentOutline: outline,
            resourceKey: record.resourceKey,
            epoch: record.epoch,
        };
    }

    saveDesktop(state: OperationState, resourceKey: string, epoch: number): void {
        if (!state.currentTarget || !state.currentCapture || !state.currentLook || !state.currentOutline) return;
        this.store.set({
            stateId: state.currentCapture.stateId,
            resourceKey,
            epoch,
            value: {
                kind: "desktop",
                target: { ...state.currentTarget },
                capture: { ...state.currentCapture },
                look: {
                    lookId: state.currentLook.lookId,
                    capturedAt: state.currentLook.capturedAt,
                    window: structuredClone(state.currentLook.window),
                    image: state.currentLook.image ? { ...state.currentLook.image } : undefined,
                    timings: { ...state.currentLook.timings },
                    readText: state.currentLook.readText ? { ...state.currentLook.readText } : undefined,
                },
                outline: serializeOutline(state.currentOutline),
            },
        });
    }
}
