# pi-computer-use

Windows desktop observation and control for Pi agents.

The public surface is intentionally small and state-scoped:

```text
list_apps
get_window_state
act
wait_for
launch_app
```

`get_window_state` returns an immutable `stateId`, a compact UIA tree with numeric `elementIndex` values, and optionally a window-relative screenshot. `act` returns an outcome and a successor diff. The returned `stateId` is valid for the next call.

No other action tools are needed. The action vocabulary is inside `act`:

```text
click type_text press_key set_value scroll drag activate
```

## Installation

Install the helper:

```powershell
pnpm run build:native
node scripts/setup-helper.mjs
```

The helper is installed under:

```text
%USERPROFILE%\.pi\agent\helpers\pi-computer-use\windows-bridge.exe
```

Override it with `PI_COMPUTER_USE_WINDOWS_HELPER_PATH` for development.

## Example

```text
list_apps({ app: "notepad++" })
get_window_state({ window, includeText: true })
act({
  window,
  stateId,
  actions: [{ type: "click", elementIndex: 12 }]
})
```

`act` returns a successor `stateId` and a diff. Use that state for the next action. Call `get_window_state` again only when the outcome is `unknown`, the view is `full`, or capture failed.

Coordinates are window-relative screenshot pixels. Use `elementIndex` when the target has a UIA element. Use `x`/`y` for visual targets.

## Pi codemode

The five tools are normal Pi tools and are also callable from the built-in `codemode` tool:

```js
const apps = await tools.list_apps({});
const win = apps.windows.find(w => /Notepad/.test(w.title));
const state = await tools.get_window_state({
  window: win,
  includeText: true,
  includeScreenshot: true,
  screenshotData: true,
});
if (state.screenshots[0]?.dataUrl) image(state.screenshots[0].dataUrl);
const next = await tools.act({
  window: win,
  stateId: state.stateId,
  actions: [{ type: "click", elementIndex: 12 }],
});
```

`codemode` is optional. A Codex-style single-tool profile can set `codemode.mode` to `only`. Without it, the five tools are called directly.

## Configuration

`headless` defaults to `false`.

```json
{
  "headless": false
}
```

Global config:

```text
%USERPROFILE%\.pi\agent\extensions\pi-computer-use.json
```

Project config:

```text
.pi\computer-use.json
```

`PI_COMPUTER_USE_HEADLESS=1` forces background-only actions. `act` prefers semantic UIA operations and only escalates to foreground input when necessary.

## Development

```powershell
pnpm test
cargo test --locked --manifest-path native/windows/bridge-rs/Cargo.toml
pnpm run build:native
```

See `docs/` for the tool contract, architecture, development notes, and Windows bridge protocol.
