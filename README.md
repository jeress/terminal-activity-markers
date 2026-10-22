# Terminal Activity Monitor for VS Code

[![Latest release](https://img.shields.io/github/v/release/jeress/terminal-activity-markers)](https://github.com/jeress/terminal-activity-markers/releases/latest)

Terminal Activity Monitor for VS Code helps people who keep many integrated terminal sessions open at once.

It adds compact status dots to terminal names so the native terminal list is easier to scan:

- `🟢` — activity observed within the active window, defaulting to one hour.
- `🟡` — used within the recent window, defaulting to 24 hours.
- `⚪` — older than the recent window.

## Privacy

Terminal Activity Monitor has no telemetry, analytics, accounts, or network requests. All processing stays on the machine where the VS Code extension host runs.

The extension stores a process identity (host name, process ID, and process start time), last-activity timestamp, original terminal name, and a SHA-256 fingerprint of its own marked label in VS Code's workspace extension state. This keeps reused process IDs and separate workspaces from inheriting unrelated activity. It checks local process counters and terminal-device timestamps to detect activity. When VS Code exposes shell-output events, the extension observes their timing and recognizes only bounded OSC 0/2 application-title messages. It ignores ordinary output text. The fingerprint lets it restore its own labels without stacking old session titles after a reload. The current application title is held in memory to label the terminal; command lines, output text, and application titles are never logged, persisted, or transmitted.

## Why This Exists

VS Code is excellent at keeping terminal sessions alive, but the built-in terminal list does not provide automatic sorting, age-based grouping, or row-level color/status customization for existing terminals.

This extension is a pragmatic workaround. It watches shell-execution events, then prefixes terminal names with activity dots.

## What It Does Not Do

- It does not close terminal sessions automatically.
- It does not truly color native Terminal Explorer rows.
- It does not truly reorder the native Terminal Explorer.
- It does not retain command output; it recognizes only application-title messages in shell-integrated streams.

Native row sorting and decoration controls are not exposed through the stable terminal API.

## Install

1. Download the `.vsix` from the [latest GitHub release](https://github.com/jeress/terminal-activity-markers/releases/latest).
2. In VS Code, open the Extensions view.
3. Open the `…` menu, choose **Install from VSIX…**, and select the downloaded file.
4. Run **Developer: Reload Window** from the Command Palette.

Alternatively, install the downloaded package from a terminal:

```sh
code --install-extension terminal-activity-markers-1.1.7.vsix --force
```

On macOS, if the `code` command is not on your shell path:

```sh
'/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code' --install-extension terminal-activity-markers-1.1.7.vsix --force
```

Reload the VS Code window after installing or upgrading:

1. Open the Command Palette.
2. Run `Developer: Reload Window`.

## Build Locally

```sh
git clone https://github.com/jeress/terminal-activity-markers.git
cd terminal-activity-markers
npm ci
npm test
npm run package
```

The package command creates a `.vsix` file in the project root.

## Usage

After installation, open several integrated terminals. The extension will mark their native terminal names as activity is observed:

- Create a terminal, start a process, or run a shell command and it becomes `🟢 name`.
- Clicking between terminals does not change their activity state.
- Leave it alone past the active window and it becomes `🟡 name`.
- Leave it alone past the recent window and it becomes `⚪ name`.
- A shell-integrated application can supply a session title, displayed as `🟢 Session title` for generic terminals or `🟢 Custom name · Session title` for custom names. Title changes update on the selected terminal without losing the dot or custom terminal name.

Automatic name updates affect only the selected terminal and never reveal the terminal panel. Other terminals continue to be monitored, but their displayed dots update when selected or when you run a full refresh. Selecting a terminal updates its dot without counting as activity.

To manually force a full marker refresh, run:

```text
Terminal Activity Monitor: Refresh Native Terminal Names
```

VS Code only exposes a command to rename the active terminal, so a full refresh briefly switches through terminals whose names need updating. It can reveal the terminal panel. It requests that keyboard focus be preserved and restores the original terminal selection unless you select another terminal during the refresh. A refresh with no name changes does not reveal or switch terminals.

To remove the dots and turn off automatic markers, run **Terminal Activity Monitor: Disable and Clear Native Markers**. Re-enable them with the `nativeNameMarkers` setting.

## Settings

| Setting | Default | Description |
| --- | ---: | --- |
| `terminalActivityDashboard.activeAfterHours` | `1` | Keep a terminal green for this many hours after creation or detected shell-command, output, or CPU activity. |
| `terminalActivityDashboard.parkedAfterHours` | `24` | Turn a terminal's dot from yellow to white after this many hours without activity. |
| `terminalActivityDashboard.refreshIntervalSeconds` | `5` | Process sampling and selected-terminal dot refresh cadence. |
| `terminalActivityDashboard.nativeNameMarkers` | `true` | Prefix native terminal names with `🟢`, `🟡`, or `⚪`. |
| `terminalActivityDashboard.applicationTitles` | `true` | Append application-supplied titles from shell-integrated commands started after activation. |
| `terminalActivityDashboard.renameExistingTerminals` | `true` | Apply native name markers to terminals that were open before the extension activated. |

## How Activity Is Detected

The extension listens to VS Code terminal APIs for:

- terminal creation and close events;
- shell integration availability;
- shell command start and end events.

For shell-integrated commands, it observes output timing and parses only bounded application-title messages. On macOS and Linux, it also checks terminal-device modification times; on every platform it samples lightweight CPU counters as a fallback. This lets it recognize recent work inside long-running tools such as Codex without keeping an idle process green forever. No command lines or ordinary output text are retained.

Recent shell output or substantial CPU activity keeps a terminal green even if it has not been focused recently. Merely keeping a process open does not.

Unknown pre-existing terminals begin white until activity is observed. The first upgrade to the stronger process identity format also starts restored terminals white; old PID-only timestamps cannot safely be matched. If process identity inspection is unavailable, activity tracking continues without restoring timestamps across reloads.

VS Code does not expose arbitrary terminal output through a stable extension API, so background output that occurs outside shell-execution tracking may not update activity by itself.

## Application and Codex session titles

Version 1.1.7 hides the generic `Terminal` label. Existing descriptions remain visible beside the dot. Without a captured title, a generic terminal displays just its dot; when an application supplies a title, it displays as `🟢 Investigate membership conversion`. The label updates when Codex renames or switches sessions. Custom terminal names remain intact. Set `terminalActivityDashboard.applicationTitles` to `false` to hide the extra title.

This uses the shell-execution stream already observed for activity timing. It reads only OSC 0/2 title messages, handles messages split across output chunks, and rejects oversized or control-containing titles. Application-title text stays in memory and is never included in saved activity state; only the original terminal name and a label fingerprint are saved for safe restoration. No new background process, network request, or model call is added.

Shell integration must be available, and the application command must start after the extension activates. Commands already running when the extension activates do not expose their earlier title stream. Background titles update when the terminal is selected or during a full refresh, following the same focus-preserving behavior as activity dots.

VS Code 1.141 stops native application-title listening after a fixed terminal rename. Reading title messages from the existing execution stream keeps titles current despite that limitation. This does not change user or workspace description settings. An explicit `${sequence}` description can still show a title VS Code received before the rename; subsequent live titles appear in the marked terminal name.

Codex controls which title it sends. To send just the session name in Codex CLI 0.163.0, add this field to the existing `[tui]` table in each Codex profile's `config.toml`:

```toml
[tui]
terminal_title = ["thread-title"]
```

The extension does not change Codex configuration or generate session names. Codex applies this selection when a TUI starts; an unnamed session can initially send its session ID. See the [official OpenAI terminal title documentation](https://learn.chatgpt.com/docs/developer-commands#configure-terminal-title-items-with-title).

## Native Terminal Explorer Limitation

This extension intentionally works within stable VS Code APIs.

VS Code does not currently provide a supported way for extensions to:

- color existing native Terminal Explorer rows;
- decorate existing native Terminal Explorer rows with custom badges;
- reorder existing native Terminal Explorer rows;
- rename an arbitrary terminal without making it active.

Automatic updates rename only the selected terminal. An explicit full refresh cycles through terminals whose dots need to change, verifies each rename, and restores the previous selection unless interrupted by a user selection. Automatic failures retry with increasing delays, capped at five minutes, without repeated notifications. Explicit refreshes bypass that delay and report failures.

## Distribution

Stable builds are available as GitHub release artifacts. A Visual Studio Marketplace listing is planned; until its publisher credentials are configured, install the VSIX from GitHub Releases.

If VS Code eventually adds stable APIs for terminal row decoration, sorting, or arbitrary-terminal renaming, this extension should move to those APIs.

## Development

```sh
npm ci
npm run compile
npm test
npm run package
```

Useful files:

- `src/extension.ts` — VS Code events, activity tracking, and persistence scheduling.
- `src/model.ts` — three activity buckets, marker cleanup, and process parsing.
- `src/renamer.ts` and `src/scheduler.ts` — selection-safe renaming and bounded work queues.
- `src/processes.ts` and `src/state.ts` — process inspection and validated restoration.
- `src/titles.ts` — bounded streaming parser for application-title messages.
- `test/` — regression tests for tracking, renaming, queues, persistence, and process inspection.

Packaging compiles the extension automatically. CI runs tests and builds a VSIX on macOS, Linux, and Windows with Node.js 22.

## License

MIT
