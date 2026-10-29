# Development

## Repository layout

```text
extensions/computer-use.ts       five public Pi tools
src/bridge.ts                    tool coordination and state flow
src/contract.ts                  public inputs/results
src/schemas.ts                   structured output schemas
src/actions.ts                   action validation and preparation
src/outline.ts                   UIA outline parsing, folding, query, indexes
src/view.ts                      ref stabilization and successor diffs
src/state.ts                     immutable observation store
src/runtime.ts                   bounded state store and resource scheduler
src/output.ts                    bounded model-facing output
src/platform/windows/            Windows backend and helper client
native/windows/bridge-rs/        Rust UIA/capture/input/launch helper
```

Keep the public surface at five tools. Internal complexity belongs in `bridge.ts`, `outline.ts`, `view.ts`, and the native helper.

## Checks

```powershell
pnpm test
cargo test --locked --manifest-path native/windows/bridge-rs/Cargo.toml
pnpm run build:native
```

`pnpm test` covers:
- TypeScript typechecking
- function-call schema compatibility
- bounded output
- state-store and scheduler concurrency
- public-surface invariants
- platform/backend conformance
- native helper build/install scripts
- packaged prebuilt helper and skill assets

## Architecture rules

- The only public action entrypoint is `act`.
- Every action is bound to an immutable `stateId`.
- Elements are model-facing numeric `elementIndex` values.
- Coordinates are window-relative screenshot pixels.
- Cached queries use the full stored outline; no recapture.
- Successor states return a diff unless identity confidence is low or the change budget is exceeded.
- `wait_for` uses native UIA waits; never add a polling loop.
- `launch_app` never interprets shell commands.
- Do not add browser/CDP surfaces.
- Do not add a custom JS REPL; use Pi codemode.

Run `pnpm run test:invariants` after changing the public surface or state model.

## Native helper

Build:

```powershell
pnpm run build:native
```

The release binary is written to `prebuilt/windows/windows-bridge.exe` and installed to:

```text
%USERPROFILE%\.pi\agent\helpers\pi-computer-use\windows-bridge.exe
```

Set `PI_COMPUTER_USE_WINDOWS_HELPER_PATH` for an isolated test destination.

## Manual smoke test

- `list_apps` returns windows.
- `get_window_state` returns a tree and `stateId`.
- `get_window_state` with `stateId` and `query` does not recapture.
- `act` clicks an element and returns a successor diff.
- `wait_for` returns a successor state.
- `launch_app` returns a new window.
- Codemode calls `tools.list_apps`, `tools.get_window_state`, and `tools.act`.
