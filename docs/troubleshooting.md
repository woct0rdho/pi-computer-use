# Troubleshooting

## Platform setup

Windows uses a per-user native helper and the active desktop session. The helper is installed to:

```text
%USERPROFILE%\.pi\agent\helpers\pi-computer-use\windows-bridge.exe
```

No separate permission grant is required. The desktop must be unlocked while the helper runs.

## Windows helper is missing

Install the helper from the package:

```bash
node scripts/setup-helper.mjs --runtime
```

Or rebuild it locally:

```bash
pnpm run build:native
node scripts/setup-helper.mjs
```

If the helper was built but setup reports a file-lock error, an existing helper process is still running. Close it and run the setup script again.

## Non-interactive setup fails

Desktop computer use requires an interactive user session. Run Pi in an unlocked interactive desktop session rather than a service, headless, or disconnected session.

## Headless mode blocks an action

`headless: true` blocks raw pointer events, raw keyboard events, foreground focus fallback, and cursor takeover.

Use UIA patterns for `click`, `set_value`, and `scroll` from the latest `get_window_state` result. Actions without a UIA pattern, plus `type_text` and `press_key`, require foreground mode. If the workflow needs raw events or keyboard text, disable `headless`.

## State or element indexes are stale

Element indexes and coordinates belong to the latest observed state. Call `get_window_state` again and retry with the new `stateId`.

The bridge preserves element indexes across trustworthy successor states, but a stale or evicted state is never replayed.

## Coordinates are rejected

Coordinates are screenshot pixels from the latest observed window. They are invalid if:
- the window changed size
- the target window changed
- a new observation was captured
- the coordinate is outside the captured bounds

Call `get_window_state` again and retry.

## Capture fails

Check that:
- The target app has an open window.
- The window was not closed between `get_window_state` and `act`.
- The app is running in an interactive, unlocked desktop session.
- The window is not minimized or fully offscreen.

If the target is ambiguous, filter `list_apps` and pass the exact returned window:

```ts
list_apps({ app: "notepad++", title: "Untitled" })
get_window_state({ window, includeText: true })
```

If a modal opens or the observed target closes, use the `nextWindows` returned by `act` instead of guessing the replacement window.
