# Configuration

Configuration controls browser access and strict accessibility execution.

## Files

Global config:

```text
%USERPROFILE%\.pi\agent\extensions\pi-computer-use.json
```

Project config:

```text
.pi\computer-use.json
```

Project config overrides global config. Environment variables override both.

Example:

```json
{
  "browser_use": true,
  "managed_browser": "chrome",
  "headless": false
}
```

Run `/computer-use` in Pi to show the active config and its source.

## Options

### `browser_use`

Default: `true`

When `false`, the extension refuses known browser windows. This is useful for projects that should not control browsers.

Known browser families include Chrome and Chromium-family browsers, Firefox, Brave, Edge, Vivaldi, Opera, and Helium.

### `managed_browser`

Default: `"chrome"`

Selects `"helium"` or `"chrome"` for `launch_browser`. The debugging port is always allocated internally and isn't part of the model-facing contract.

### `headless`

Default: `false`

When `true`, actions must remain in the background. Raw pointer events, raw keyboard events, foreground focus fallback, and cursor takeover are blocked. When `false` (the default), Pi prefers verified semantic activation when it is credible, preserves the focus established by editable clicks for dependent keyboard input, and may retry keyboard input in the foreground when a background attempt conclusively produced no value change. Ambiguous pointer actions are never replayed blindly.

## Environment variables

```bash
PI_COMPUTER_USE_BROWSER_USE=0
PI_COMPUTER_USE_BROWSER_USE=1
PI_COMPUTER_USE_MANAGED_BROWSER=helium
PI_COMPUTER_USE_MANAGED_BROWSER=chrome
PI_COMPUTER_USE_CHROME_EXECUTABLE=C:\path\to\chrome.exe
PI_COMPUTER_USE_HELIUM_EXECUTABLE=C:\path\to\helium.exe
PI_COMPUTER_USE_HEADLESS=0
PI_COMPUTER_USE_HEADLESS=1
PI_COMPUTER_USE_DELIVERY_POLICY=default
PI_COMPUTER_USE_DELIVERY_POLICY=foreground
PI_COMPUTER_USE_CDP_PORT=9222
PI_COMPUTER_USE_WINDOWS_HELPER_PATH=C:\path\to\windows-bridge.exe
```

`PI_COMPUTER_USE_HEADLESS=1` prohibits foreground fallback. `PI_COMPUTER_USE_DELIVERY_POLICY` is a debugging input; normal policy belongs in configuration rather than individual model calls.

`launch_browser` searches common Windows install locations and `PATH`. Use `PI_COMPUTER_USE_CHROME_EXECUTABLE` or `PI_COMPUTER_USE_HELIUM_EXECUTABLE` for a portable or non-standard install. An explicit override is authoritative and must name an executable file.

## CDP browser support

`PI_COMPUTER_USE_CDP_PORT` enables Chrome DevTools Protocol support for Chromium-family browsers. Launch the browser with `--remote-debugging-port=<port>` and set this variable to the same port.

Use a dedicated, non-default profile with `--user-data-dir=<directory>`. Chrome 136 and later ignore remote-debugging switches for the default data directory as a security measure. `launch_browser` already creates a temporary, separate CDP profile and binds discovery to a randomly allocated loopback port.

When CDP is active, discovered pages participate in the same root and state system as desktop UI. `launch_browser` configures CDP automatically and returns an observed page state. `navigate_browser` and `evaluate_browser` accept only CDP browser-page states; native browser windows continue to use the normal desktop observe/act tools.

With the variable unset, CDP is inactive.
