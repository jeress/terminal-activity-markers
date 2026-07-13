# Terminal Activity Markers

Terminal Activity Markers is a VS Code extension for people who keep many integrated terminal sessions open at once.

It adds automatic status prefixes to terminal names so the native Terminal Explorer is easier to scan:

- `🟢 Active` — used within the active window, defaulting to one hour, or currently running a shell command.
- `🟡 Recent` — used within the recent window, defaulting to 24 hours.
- `⚪ Idle` — older than the recent window.

It also adds a small **Terminal Activity** view in the Explorer sidebar with the same Active, Recent, and Idle grouping.

## Why This Exists

VS Code is excellent at keeping terminal sessions alive, but the built-in terminal list does not provide automatic sorting, age-based grouping, or row-level color/status customization for existing terminals.

This extension is a pragmatic workaround. It watches terminal focus and shell-execution events, then prefixes terminal names with activity markers.

## What It Does Not Do

- It does not close terminal sessions automatically.
- It does not truly color native Terminal Explorer rows.
- It does not truly reorder the native Terminal Explorer.
- It does not read arbitrary terminal output.

Those capabilities are not exposed through VS Code's stable extension API.

## Install From A VSIX

Download or build a `.vsix` package, then install it with VS Code:

```sh
code --install-extension terminal-activity-markers-0.2.6.vsix --force
```

On macOS, if the `code` command is not on your shell path:

```sh
'/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code' --install-extension terminal-activity-markers-0.2.6.vsix --force
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

- Use or focus a terminal and it becomes `🟢 Active`.
- Leave it alone past the active window and it becomes `🟡 Recent`.
- Leave it alone past the recent window and it becomes `⚪ Idle`.

The Explorer sidebar also includes a **Terminal Activity** section with the same grouping.

To manually force a full marker refresh, run:

```text
Terminal Activity Dashboard: Refresh Native Terminal Names
```

Use that command sparingly. VS Code only exposes a command to rename the active terminal, so a full refresh has to briefly switch through terminals to rename them.

## Settings

| Setting | Default | Description |
| --- | ---: | --- |
| `terminalActivityDashboard.activeAfterHours` | `1` | Keep a terminal marked `Active` for this many hours after it was focused or used. |
| `terminalActivityDashboard.parkedAfterHours` | `24` | Keep a terminal marked `Recent` until this many hours after last activity; older sessions become `Idle`. |
| `terminalActivityDashboard.refreshIntervalSeconds` | `30` | Refresh cadence for the sidebar view and age calculations. |
| `terminalActivityDashboard.nativeNameMarkers` | `true` | Prefix native terminal names with `🟢 Active`, `🟡 Recent`, or `⚪ Idle`. |
| `terminalActivityDashboard.renameExistingTerminals` | `true` | Apply native name markers to terminals that were open before the extension activated. |

## How Activity Is Detected

The extension listens to VS Code terminal APIs for:

- terminal creation and close events;
- active terminal changes;
- shell integration availability;
- shell command start and end events.

If shell integration reports a running command, that terminal is marked Active even if it has not been focused recently.

VS Code does not expose arbitrary terminal output through a stable extension API, so background output that occurs outside shell-execution tracking may not update activity by itself.

## Native Terminal Explorer Limitation

This extension intentionally works within stable VS Code APIs.

VS Code does not currently provide a supported way for extensions to:

- color existing native Terminal Explorer rows;
- decorate existing native Terminal Explorer rows with custom badges;
- reorder existing native Terminal Explorer rows;
- rename an arbitrary terminal without making it active.

Because terminal renaming targets the active terminal, this extension avoids automatic full-list rename sweeps during ordinary clicking and focus changes. Normal use updates only the terminal being selected or used. The manual refresh command can still do a full sync when needed.

## Marketplace Status

This extension is marked as preview because it relies on terminal-name prefixes as a workaround for native Terminal Explorer limitations.

If VS Code eventually adds stable APIs for terminal row decoration, sorting, or arbitrary-terminal renaming, this extension should move to those APIs.

## Development

```sh
npm install
npm run compile
npm test
npm run package
```

Useful files:

- `src/extension.ts` — VS Code extension activation, terminal tracking, tree view, and native-name marker logic.
- `src/model.ts` — activity bucket classification and age formatting.
- `test/model.test.ts` — unit tests for activity classification.

## License

MIT
