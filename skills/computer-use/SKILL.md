---
name: computer-use
description: Control Windows desktop apps with pi-computer-use. Use for GUI tasks that need finding windows, reading UIA/screenshots, clicking, typing, waiting, or launching apps.
---

# Computer Use

Workflow:

```text
list_apps -> get_window_state -> act -> act -> wait_for
```

- Pass back the exact `window` object from `list_apps`.
- `get_window_state` returns a `stateId`, a folded UIA tree, and optionally a screenshot.
- Use numeric `elementIndex` values from the current tree. They belong to that `stateId`.
- Coordinates are window-relative screenshot pixels. A state without a screenshot needs `get_window_state` with `refresh: true` and `includeScreenshot: true`.
- `act` returns a successor `stateId` and a diff. Use it directly.
- Observe again only when the outcome is `unknown`, the view is `full`, or capture failed.
- Use `wait_for` for asynchronous UI. Do not poll or sleep.
- After a click establishes editable focus, omit `elementIndex` from `type_text`/`press_key`.

Query a cached state without recapturing:

```js
get_window_state({ window, stateId, query: { text: "Save", role: "button" } })
get_window_state({ window, stateId, elementIndex: 12, depth: 3 })
```

## Codemode

```js
const apps = await tools.list_apps({});
const window = apps.windows.find(w => /Notepad/.test(w.title));
const state = await tools.get_window_state({
  window,
  includeText: true,
  screenshotData: true,
});
if (state.screenshots[0]?.dataUrl) image(state.screenshots[0].dataUrl);
const next = await tools.act({
  window,
  stateId: state.stateId,
  actions: [{ type: "click", elementIndex: 12 }],
});
store("window", window);
store("stateId", next.stateId);
```

Codemode has no timers. Use `wait_for`. Actions completed before a script failure are not undone.
