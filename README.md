# pi-computer-use

## What this package does

This is a Pi extension. After installation, Pi agents get tools for:
- finding open apps and windows
- observing what is visible in a window
- searching the visible interface for text, buttons, and controls
- inspecting parts of the interface in more detail
- clicking, typing, scrolling, and pressing UI controls
- waiting for UI changes

## Development status

The architecture is centered on immutable, state-scoped observations. Desktop windows and transient surfaces form one multi-root forest. Progressive outline queries remain cached, while live work is ordered per physical resource so independent roots can run in parallel. 

`act_ui` accepts one or more intent steps, preserves focus across dependent input, verifies delivery, recovers safely, stores one complete successor state, and returns a compact diff when identity confidence allows. Older direct tools such as `screenshot`, `click`, `set_text`, and `computer_actions` are no longer part of the public extension surface.
