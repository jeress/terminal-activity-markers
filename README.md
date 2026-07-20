# Terminal Activity Monitor for VS Code

[![Latest release](https://img.shields.io/github/v/release/jeress/terminal-activity-markers)](https://github.com/jeress/terminal-activity-markers/releases/latest)

Terminal Activity Monitor for VS Code helps people who keep many integrated terminal sessions open at once.

It adds compact status markers to terminal names so the native terminal list is easier to scan:

- `🟢🟢` — output, CPU, or shell-command activity was detected within the live window, defaulting to 15 seconds.
- `✅` — a qualifying shell command completed while its terminal was not selected.
- `❌` — a qualifying shell command failed while its terminal was not selected.
- `🟢` — used within the active window, defaulting to one hour.
- `🟡` — used within the recent window, defaulting to 24 hours.
- `⚪` — older than the recent window.

Selecting a terminal acknowledges its `✅` or `❌` marker without changing its activity age.

## Privacy

Terminal Activity Monitor has no telemetry, analytics, accounts, or network requests. All processing stays on the machine where the VS Code extension host runs.

The extension stores only each terminal's process ID and last-activity timestamp in VS Code's local extension state. It checks local process counters and terminal-device timestamps to detect activity. When VS Code exposes shell-output events, the extension uses only their timing and immediately discards the content. Command lines and terminal output are never logged, stored, or transmitted.

## Why This Exists

VS Code is excellent at keeping terminal sessions alive, but the built-in terminal list does not provide automatic sorting, age-based grouping, or row-level color/status customization for existing terminals.

This extension is a pragmatic workaround. It watches shell-execution events, then prefixes terminal names with activity dots.

## What It Does Not Do

- It does not close terminal sessions automatically.
- It does not truly color native Terminal Explorer rows.
- It does not truly reorder the native Terminal Explorer.
- It does not inspect or store terminal output content.

Those capabilities are not exposed through VS Code's stable extension API.

## Install

1. Download the `.vsix` from the [latest GitHub release](https://github.com/jeress/terminal-activity-markers/releases/latest).
2. In VS Code, open the Extensions view.
3. Open the `…` menu, choose **Install from VSIX…**, and select the downloaded file.
4. Run **Developer: Reload Window** from the Command Palette.

Alternatively, install the downloaded package from a terminal:

```sh
code --install-extension terminal-activity-markers-1.1.2.vsix --force
```

On macOS, if the `code` command is not on your shell path:

```sh
'/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code' --install-extension terminal-activity-markers-1.1.2.vsix --force
```

Reload the VS Code window after installing or upgrading:

1. Open the Command Palette.
2. Run `Developer: Reload Window`.

## Build Locally

```sh
git clone https://github.com/jeress/terminal-activity-markers.git
cd terminal-activity-markers
npm install
npm test
npm run package
```

The package command creates a `.vsix` file in the project root.

## Usage

After installation, open several integrated terminals. The extension will mark their native terminal names as activity is observed:

- Create a terminal, start a process, or run a shell command and it becomes `🟢 name`.
- While activity is being detected, it becomes `🟢🟢 name`.
- Leave a qualifying command running, select another terminal, and it becomes `✅ name` or `❌ name` when the command finishes.
- Select the completed terminal to acknowledge the completion marker.
- Clicking between terminals does not change their activity state.
- Leave it alone past the active window and it becomes `🟡 name`.
- Leave it alone past the recent window and it becomes `⚪ name`.

To manually force a full marker refresh, run:

```text
Terminal Activity Monitor: Refresh Native Terminal Names
```

Use that command sparingly. VS Code only exposes a command to rename the active terminal, so a full refresh has to briefly switch through terminals to rename them.

To remove the dots and turn off automatic markers, run **Terminal Activity Monitor: Disable and Clear Native Markers**. Re-enable them with the `nativeNameMarkers` setting.

## Settings

| Setting | Default | Description |
| --- | ---: | --- |
| `terminalActivityDashboard.activeAfterHours` | `1` | Keep a terminal green for this many hours after creation or reported shell command activity. |
| `terminalActivityDashboard.parkedAfterHours` | `24` | Turn a terminal's dot from yellow to white after this many hours without activity. |
| `terminalActivityDashboard.refreshIntervalSeconds` | `5` | Refresh cadence for native terminal activity dots. |
| `terminalActivityDashboard.liveIndicatorSeconds` | `15` | Keep `🟢🟢` visible for this many seconds after detected activity; `0` disables it. |
| `terminalActivityDashboard.completionMarkers` | `true` | Mark unseen shell-command completion or failure until the terminal is selected. |
| `terminalActivityDashboard.completionMinimumSeconds` | `10` | Ignore completion markers for commands shorter than this many seconds. |
| `terminalActivityDashboard.nativeNameMarkers` | `true` | Prefix native terminal names with `🟢`, `🟡`, or `⚪`. |
| `terminalActivityDashboard.renameExistingTerminals` | `true` | Apply native name markers to terminals that were open before the extension activated. |

## How Activity Is Detected

The extension listens to VS Code terminal APIs for:

- terminal creation and close events;
- shell integration availability;
- shell command start and end events.

For shell-integrated commands, it observes output timing and immediately discards the content. On macOS and Linux, it also checks terminal-device modification times; on every platform it samples lightweight CPU counters as a fallback. This lets it recognize recent work inside long-running tools such as Codex without keeping an idle process green forever. No command lines or output content are collected.

Recent shell output or substantial CPU activity keeps a terminal green even if it has not been focused recently. The `🟢🟢` marker identifies the much shorter live-activity window. Merely keeping a process open does not.

With shell integration, VS Code also reports when a command ends and may report its exit code. Commands that meet the configured minimum duration receive `✅` or `❌` when they finish off-screen. The marker is an unread completion signal, not additional stored history.

VS Code does not expose arbitrary terminal output through a stable extension API, so background output that occurs outside shell-execution tracking may not update activity by itself. Long-lived interactive programs such as Codex appear to VS Code as one shell command, so the extension can indicate their live and quiet periods but cannot reliably identify when an individual task inside them is complete.

## Native Terminal Explorer Limitation

This extension intentionally works within stable VS Code APIs.

VS Code does not currently provide a supported way for extensions to:

- color existing native Terminal Explorer rows;
- decorate existing native Terminal Explorer rows with custom badges;
- reorder existing native Terminal Explorer rows;
- rename an arbitrary terminal without making it active.

Because terminal renaming targets the active terminal, a refresh briefly cycles through terminals whose dots need to change, then restores the previously active terminal. The extension verifies each rename and retries when VS Code focus changes lag behind.

## Distribution

Stable builds are available as GitHub release artifacts. A Visual Studio Marketplace listing is planned; until its publisher credentials are configured, install the VSIX from GitHub Releases.

If VS Code eventually adds stable APIs for terminal row decoration, sorting, or arbitrary-terminal renaming, this extension should move to those APIs.

## Development

```sh
npm install
npm run compile
npm test
npm run package
```

Useful files:

- `src/extension.ts` — VS Code extension activation, terminal tracking, and native-name marker logic.
- `src/model.ts` — activity bucket classification and age formatting.
- `test/model.test.ts` — unit tests for activity classification.

## License

MIT
