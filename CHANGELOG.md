# Changelog

## 0.2.6

- Changed `Active` to mean used within the active time window, defaulting to one hour, or currently running a command.
- Limited automatic native terminal renaming during normal focus changes to the selected terminal to avoid interfering with terminal selection.

## 0.2.5

- Renamed native terminal markers to `Active`, `Recent`, and `Idle`.

## 0.2.4

- Mark the currently focused terminal green, even when no shell command is actively running.

## 0.2.3

- Added emoji status markers to native terminal-name prefixes: green for running, yellow for recently used, and white for idle.
- Restored native terminal-name markers to default-on behavior.

## 0.2.2

- Reduced native terminal-name marker churn during focus changes and terminal close events.

## 0.2.1

- Disabled native terminal-name markers by default to avoid interfering with VS Code's built-in terminal close/trash controls.

## 0.2.0

- Added optional native terminal-name markers for activity state.

## 0.1.1

- Moved the dashboard into the Explorer sidebar so it remains visible when the Activity Bar is hidden or relocated.

## 0.1.0

- Initial automatic terminal activity dashboard.
- Running, recent, parked, and stale groups.
- Shell execution and focus tracking with configurable age thresholds.
- Persistent activity timestamps for surviving terminal processes.
