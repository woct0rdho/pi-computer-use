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
npm run build:native
node scripts/setup-helper.mjs
```

If the helper was built but setup reports a file-lock error, an existing helper process is still running. Close it and run the setup script again.

## Non-interactive setup fails

Desktop computer use requires an interactive user session. Run Pi in an unlocked interactive desktop session rather than a service, headless, or disconnected session.

## Browser windows are refused

Check the active config:

```text
/computer-use
```

If `browser_use` is disabled, enable it in either config file:

```json
{
  "browser_use": true
}
```

If `launch_browser` cannot find the selected browser, set `PI_COMPUTER_USE_CHROME_EXECUTABLE` or `PI_COMPUTER_USE_HELIUM_EXECUTABLE` to an executable absolute path. A manual Chromium CDP launch needs both `--remote-debugging-port` and a non-default `--user-data-dir`.

## Strict accessibility mode blocks an action

Headless mode blocks raw pointer events, raw keyboard events, foreground focus fallback, and cursor takeover.

Use refs from the latest `observe_ui` result. If the workflow needs raw events, disable strict accessibility mode.

## State or refs are stale

Refs and coordinates belong to the latest observed state. Call `observe_ui` again and retry with the new `stateId`.

The bridge can sometimes reacquire stale accessibility refs by role, label, capability, and position, but this is not guaranteed.

## Coordinates are rejected

Coordinates are image pixels from the latest observed window. They are invalid if:

- the window changed size
- the target window changed
- a new observation was captured
- the coordinate is outside the captured bounds

Call `observe_ui` again and retry.

## Capture fails

Check that:

- The target app has an open window.
- The window was not closed between `observe_ui` and `act_ui`.
- The app is running in an interactive, unlocked desktop session.
- The window is not minimized or fully offscreen.

If the target is ambiguous, specify the app and window title:

```ts
observe_ui({ app: "Notepad", windowTitle: "Untitled" })
```
