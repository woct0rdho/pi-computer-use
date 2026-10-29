# Configuration

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

Edit the file and reload Pi to apply changes.

## `headless`

Default: `false`

When `true`, actions must remain in the background. Raw pointer events, raw keyboard events, foreground focus fallback, and cursor takeover are blocked.

When `false`, `act` prefers verified semantic activation, preserves focus established by editable clicks, and may retry keyboard input in the foreground when a background attempt conclusively produced no value change. Ambiguous pointer actions are never replayed.

Environment variables:

```bash
PI_COMPUTER_USE_HEADLESS=0
PI_COMPUTER_USE_HEADLESS=1
PI_COMPUTER_USE_DELIVERY_POLICY=default
PI_COMPUTER_USE_DELIVERY_POLICY=foreground
PI_COMPUTER_USE_WINDOWS_HELPER_PATH=C:\path\to\windows-bridge.exe
```

Normal delivery policy belongs in configuration, not model calls.

## Codemode

The CUA tools work without codemode. To use the built-in JavaScript orchestration layer, enable it:

```json
{
  "defaultTools": ["+codemode"]
}
```

For a Codex-style single top-level CUA surface, hide the five direct declarations while keeping them callable from scripts:

```json
{
  "codemode": {
    "mode": "only",
    "inlineBudget": 6000
  }
}
```

The five tool declarations are compact. The higher budget ensures `act` and `get_window_state` stay visible in the codemode description.

Without `mode: "only"`, the model sees the five tools plus `codemode` and can choose either path.
