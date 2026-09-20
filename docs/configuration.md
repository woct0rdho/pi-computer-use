# Configuration

Configuration controls strict accessibility execution.

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
  "headless": false
}
```

Run `/computer-use` in Pi to show the active config and its source.

## Options

### `headless`

Default: `false`

When `true`, actions must remain in the background. Raw pointer events, raw keyboard events, foreground focus fallback, and cursor takeover are blocked. When `false` (the default), Pi prefers verified semantic activation when it is credible, preserves the focus established by editable clicks for dependent keyboard input, and may retry keyboard input in the foreground when a background attempt conclusively produced no value change. Ambiguous pointer actions are never replayed blindly.

## Environment variables

```bash
PI_COMPUTER_USE_HEADLESS=0
PI_COMPUTER_USE_HEADLESS=1
PI_COMPUTER_USE_DELIVERY_POLICY=default
PI_COMPUTER_USE_DELIVERY_POLICY=foreground
PI_COMPUTER_USE_WINDOWS_HELPER_PATH=C:\path\to\windows-bridge.exe
```

`PI_COMPUTER_USE_HEADLESS=1` prohibits foreground fallback. `PI_COMPUTER_USE_DELIVERY_POLICY` is a debugging input; normal policy belongs in configuration rather than individual model calls.
