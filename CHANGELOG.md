# Changelog

## 1.1.1

- Prevent user selection and internal terminal-renaming focus changes from triggering false live activity.

## 1.1.0

- Show `🟢🟢` while current output, CPU, or shell-command activity is being detected.
- Mark qualifying off-screen shell command completions with `✅` or `❌` until the terminal is selected.
- Add settings for the live-indicator window, completion markers, and minimum command duration.
- Return to green, yellow, or white age dots after transient status markers clear.

## 1.0.5

- Remove unused local storage of the last shell command.
- Document the extension's local-only operation and absence of telemetry or network requests.

## 1.0.4

- Track shell-execution output timing while discarding output content.
- Track terminal-device output timestamps on macOS and Linux without reading output content.
- Require substantial CPU activity and stop treating command/process lifetime as continuous activity.
- Initialize unknown pre-existing terminals as white so only observed work promotes them.

## 1.0.3

- Sample recent CPU and process-start activity instead of treating every long-lived child process as continuously active.
- Reduce the default detection interval from 30 seconds to 5 seconds.

## 1.0.2

- Detect live child processes so work that began before extension startup is still marked green.
- Keep terminal selection independent from activity state.

## 1.0.1

- Terminal selection no longer changes activity timestamps or turns terminals green.
- Reset timestamps polluted by focus-based tracking when upgrading from 1.0.0.

## 1.0.0

- Renamed the public display name to **Terminal Activity Monitor for VS Code** while preserving the existing extension ID.
- Stable native terminal-list activity dots: `🟢` active, `🟡` recent, and `⚪` idle.
- Activity follows terminal selection and shell command events without counting internal rename focus changes.
- Removed the redundant Explorer and panel dashboards.
- Added verified rename retries, legacy marker cleanup, and a clear-markers command.

## 0.3.8

- Mark the currently selected terminal green, including the active terminal when the extension starts.
- Ignore focus changes caused by internal rename sweeps so they do not falsely mark every terminal active.

## 0.3.7

- Show compact `🟢`, `🟡`, and `⚪` activity dots directly in VS Code's native terminal list.
- Removed the Explorer and panel dashboard views.
- Stopped terminal focus changes from falsely recording command activity.
- Added verified, retrying terminal renames and legacy marker cleanup.

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
