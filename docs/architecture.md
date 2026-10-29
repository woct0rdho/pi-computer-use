# Architecture

`pi-computer-use` is a Windows-only Pi extension with a five-tool, state-scoped contract:

```text
list_apps -> get_window_state -> act / wait_for -> successor state
```

The model-facing surface is deliberately small. Internals keep UIA extraction, capture, input, scheduling, and verification behind it.

## Public contract

| Tool | Contract |
|---|---|
| `list_apps` | Discover running apps and top-level windows. |
| `get_window_state` | Capture or query an immutable `stateId`. |
| `act` | Execute one checked action transaction and return a successor diff. |
| `wait_for` | Wait for a scoped UI condition and return a successor state. |
| `launch_app` | Launch an app/URI through the native helper. |

All tools declare an `outputSchema`. Codemode scripts receive `structuredContent`. Direct model calls receive compact text and optional images.

## Runtime

```text
extension tool
  -> state lookup by stateId
  -> resource scheduler
  -> platform backend
  -> windows-bridge.exe
  -> UIA / WGC / SendInput
```

### State ownership

`SavedStates` stores immutable observations in a bounded `StateStore` (128 entries). One observation is:
- public `window`
- internal native `lookId`
- full UIA `Outline`
- optional screenshot
- resource key and epoch

`get_window_state` creates a state. `act` and `wait_for` create a successor. Cached queries use the stored outline and do not recapture.

State IDs are process-lifetime. They are not reconstructed from the transcript after a restart. Old IDs fail clearly and the model observes again.

### Scheduling

Live work is ordered per desktop process with `ResourceScheduler`:
- Cached `get_window_state` queries bypass the scheduler.
- Reads can overlap for different processes.
- Writes increment the resource epoch before dispatch.
- Stale writes fail before touching the desktop.

### Successor diffs

After `act`/`wait_for`, the bridge captures a successor, stabilizes element identities with `stabilizeRefs`, and compares it with the base outline:
- Small trustworthy changes render a diff.
- Root replacement, low identity confidence, or a large change budget render a full folded tree.
- The element indexes are numeric and state-scoped.

There is no running-note model and no transcript reconstruction.

## Action execution

`act` converts the public action union into internal `EngineAction` requests:

```text
click        -> press (semantic) or click (coordinates)
type_text    -> typeText
press_key    -> keypress
set_value    -> setText
scroll       -> scroll
drag         -> drag
activate     -> focusWindow
```

`actions.ts` validates targets, resolves element references, preserves click-established focus, and decides when a failed keyboard action may safely retry in the foreground.

The bridge prefers semantic UIA execution. It escalates to foreground input only when the operation requires it or a side-effect-free keyboard attempt conclusively failed. Pointer actions are never replayed after an ambiguous result.

## Native Windows layer

`windows-bridge.exe` is a stdio JSON-lines helper with:
- UIA control-view extraction
- WGC capture with PrintWindow/GDI fallback
- SendInput and foreground validation
- native `actBatch`
- UIA `uiaReadText`
- UIA `uiaWaitFor`
- `launchApp` through `ShellExecuteExW`
- a fixed worker pool and protected physical input

The helper is stateless at the public seam. It owns short-lived look records and resolves refs against the look that produced them.

## Codemode

The five tools are normal direct Pi tools and are therefore callable from `codemode` scripts.

There is no custom REPL. Codemode supplies the QuickJS sandbox, tool pipeline, permission checks, output limits, and image helper.

Two details matter:
- Codemode nested calls return `structuredContent`, not image blocks. `get_window_state({ screenshotData: true })` puts a data URL into `screenshots[0].dataUrl` for `image()`.
- Codemode has no timers. Use `wait_for`, not sleep loops.
