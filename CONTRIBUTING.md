# Contributing

Thanks for helping improve `pi-computer-use`.

## Before you start

Open an issue before starting work. Use it to agree on scope, validation, and any user-facing behavior changes.

## Setup

```bash
npm install
npm test
```

Run this checkout in Pi:

```bash
pi --no-extensions -e .
```

If you change native code, rebuild the helper:

```bash
npm run build:native
```

The helper is installed per user to:

```text
%USERPROFILE%\.pi\agent\helpers\pi-computer-use\windows-bridge.exe
```

## Validation

Use the smallest check that proves the change:

- Documentation changes: proofread changed files and check touched links or commands.
- TypeScript or schema changes: run `npm test`.
- Native helper changes: run `cargo test --locked` in `native/windows/bridge-rs`, then `npm run build:native` and `npm test`.
- Behavior changes: exercise the registered extension tools against a real Windows app in an interactive desktop session.

## Commit messages

Use:

```text
feat|chore|refactor|fix(<scope>): <summary>
```

Examples:

```text
feat(scene): add label association
fix(config): document strict accessibility env vars
refactor(extension): simplify public tool surface
```

Check a range locally with:

```bash
npm run test:commits -- <base>..<head>
```

## Pull requests

A PR should include:

- the linked issue
- a short description of the user-facing change
- accessibility or focus impact if relevant
- validation results

Keep unrelated formatting and generated output out of the PR.

## AI-assisted work

If AI tools helped produce the PR, include the thread or transcript so reviewers can see the context.

## Releases

Release notes use [`notes/release-template.md`](./notes/release-template.md). Maintainers handle releases.
