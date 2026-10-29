# Windows Bridge

`windows-bridge.exe` is the native helper for the Windows backend. It is spawned by the TypeScript client and speaks stdin/stdout JSON-lines protocol.

## Commands

| Command | Purpose |
|---|---|
| `diagnostics` | Protocol version, architecture invariants, process metadata. |
| `listRoots` | Enumerate visible top-level windows and transient roots. |
| `look` | Capture a UIA outline and optional screenshot for one root. |
| `focusWindow` | Raise/focus one root. |
| `act` | Execute one checked action against a look. |
| `actBatch` | Execute a one-root action transaction. |
| `uiaReadText` | Read a page from a text-bearing UIA element. |
| `uiaWaitFor` | Wait for a scoped UIA condition. |
| `launchApp` | Launch an executable, shortcut, or URI. |

## Root metadata

Windows roots are visible top-level HWNDs:
- `#32768` => `kind: "menu"`
- `#32770` => `kind: "dialog"`
- owned popups => `kind: "popover"`
- other HWNDs => `kind: "window"`

The helper declares per-monitor-v2 DPI awareness and reports `scaleFactor = GetDpiForWindow(hwnd) / 96`.

## Observation

`look` combines:
- UIA control-view extraction
- optional Windows.Graphics.Capture
- PrintWindow/GDI fallback
- bounded outline extraction
- native look ownership

The TypeScript layer assigns numeric element indexes from the stable internal refs and folds the full tree for the model.

## Actions

`act` resolves ref targets against the exact look that produced them:
- `press`/`click`: Invoke, Toggle, SelectionItem, ExpandCollapse, LegacyIAccessible
- `setText`: ValuePattern with read-back
- `scroll`: ScrollPattern, optional raw-input fallback
- `typeText`, `keypress`, `drag`: raw input with foreground policy
- coordinate actions: foreground activation, occlusion preflight, and `SendInput`

Coordinate targets require a screenshot-bearing look. Ambiguous pointer outcomes are reported as `unknown` and are not replayed.

## launchApp

`launchApp` uses `ShellExecuteExW` with `SEE_MASK_NOCLOSEPROCESS`:
- refuses script files (`.bat`, `.cmd`, `.ps1`, `.vbs`, `.js`, `.wsf`).
- refuses terminal launchers (`cmd.exe`, PowerShell, pwsh, Windows Terminal, conhost, WSL).
- passes arguments without shell interpretation.
- returns the launched process id.
- does not auto-elevate.

The TypeScript layer observes window appearance and returns newly appeared windows, including windows owned by an activation broker rather than the launched pid.

## Protocol envelope

```json
{ "protocolVersion": 4, "id": "req_1", "cmd": "listRoots", "args": {} }
```

```json
{ "protocolVersion": 4, "id": "req_1", "ok": true, "result": {} }
```

Errors:

```json
{
  "protocolVersion": 4,
  "id": "req_1",
  "ok": false,
  "error": { "message": "...", "code": "..." }
}
```

## Concurrency

- Multiple requests may be in flight and are correlated by id.
- A fixed worker pool initializes UIA per worker.
- Native look records are bounded. Stale looks fail closed.
- Global physical input is serialized.
- `actBatch` holds the physical-input lock when any step may use raw input and defers root deltas to one final settle.

## Installation

The helper installs to:

```text
%USERPROFILE%\.pi\agent\helpers\pi-computer-use\windows-bridge.exe
```

Override with `PI_COMPUTER_USE_WINDOWS_HELPER_PATH`.

## Limitations

- UIPI/elevated windows cannot be controlled by a non-elevated helper.
- A non-elevated `launchApp` cannot start elevated targets.
- Physical input requires the target to become foreground.
- Background semantic UIA is preferred. Pointer and keyboard input have platform restrictions.
