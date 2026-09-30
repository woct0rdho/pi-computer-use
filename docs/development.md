# Development

## Repository layout

```text
extensions/computer-use.ts       Public Pi tool registration
src/bridge.ts                    TypeScript runtime and tool implementation
src/actions.ts                   Action preparation and result reconciliation
src/runtime.ts                   Immutable state store and resource scheduler
src/state.ts                     Saved UI state ownership and restoration
src/view.ts                      Stable refs and resulting-state change views
src/outline.ts                   Outline parsing, folding, search, and ref mapping
src/schemas.ts                   Structured tool-result schemas
src/note.ts                      Disposable running-note generation
src/platform/windows/            Windows backend and helper client
native/windows/bridge-rs/        Windows UI Automation helper (Rust)
scripts/build-native.mjs         Windows helper build script
scripts/setup-helper.mjs         Windows helper install script
scripts/check-invariants.mjs     Architecture invariant checks
scripts/check-runtime-concurrency.mjs Scheduler/state concurrency checks
```

The public tool surface lives in `extensions/computer-use.ts`. Keep it small. Internal complexity belongs in `src/bridge.ts`, `src/outline.ts`, `src/note.ts`, and the native helper.

## Checks

Run all static checks:

```bash
pnpm test
```

This runs TypeScript, tool-schema compatibility checks, architecture invariants, and the Windows helper build/install script checks.

Rebuild the native helper after Rust changes:

```bash
pnpm run build:native
```

Run the native helper unit tests:

```bash
cargo test --locked --manifest-path native/windows/bridge-rs/Cargo.toml
```

## Architecture rules

The runtime is state-scoped and outline-first:

- `observe_ui` returns a folded UI outline and running note.
- `search_ui`, `expand_ui`, and `inspect_ui` provide progressive disclosure.
- `act_ui` is the only public desktop action entrypoint.
- UI observations are immutable records; request-local hydration replaces global current state.
- Cached queries bypass scheduling; live work is ordered per physical resource.
- The helper owns grounding, preflight, execution, and verification.
- Removed direct tools such as `screenshot`, `click`, `set_text`, and `computer_actions` should not reappear as public extension tools.

Run invariants after architecture changes:

```bash
pnpm run test:invariants
```

## Native Windows helper

Development uses the Windows platform backend/helper and the active desktop session. The helper is built from `native/windows/bridge-rs/` with Cargo and installs to:

```text
%USERPROFILE%\.pi\agent\helpers\pi-computer-use\windows-bridge.exe
```

Set `PI_COMPUTER_USE_WINDOWS_HELPER_PATH` to use an isolated helper location during development or testing.
