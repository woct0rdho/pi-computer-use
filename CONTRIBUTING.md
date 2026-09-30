# Contributing

## Setup

This repository uses pnpm, pinned through the `packageManager` field in `package.json`.

```bash
pnpm install
pnpm test
```

Run this checkout in Pi:

```bash
pi --no-extensions -e .
```

If you change native code, rebuild the helper:

```bash
pnpm run build:native
```

The helper is installed per user to:

```text
%USERPROFILE%\.pi\agent\helpers\pi-computer-use\windows-bridge.exe
```

## Validation

Use the smallest check that proves the change:
- Documentation changes: proofread changed files and check touched links or commands.
- TypeScript or schema changes: run `pnpm test`.
- Native helper changes: run `cargo test --locked` in `native/windows/bridge-rs`, then `pnpm run build:native` and `pnpm test`.
- Behavior changes: exercise the registered extension tools against a real Windows app in an interactive desktop session.
