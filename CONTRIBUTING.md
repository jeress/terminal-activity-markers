# Contributing

Thanks for considering a contribution.

## Development Setup

```sh
npm install
npm test
```

Use `npm run compile` for a one-off TypeScript build and `npm run watch` while editing.

## Local Extension Testing

Package and install a local VSIX:

```sh
npm run package
code --install-extension terminal-activity-markers-1.0.0.vsix --force
```

Reload the VS Code window after installation.

## Design Constraints

The extension must stay within stable VS Code extension APIs.

Do not add behavior that:

- closes terminals automatically;
- depends on undocumented VS Code internals;
- treats focus changes caused by its own rename sweeps as user activity;
- claims native terminal row coloring, decoration, sorting, or reordering.

The native terminal-list dots are implemented by renaming terminal sessions. VS Code only exposes a command to rename the active terminal, so rename sweeps must suppress their own focus events, verify each rename, and restore the user's active terminal.

## Before Opening A Pull Request

Run:

```sh
npm test
npm run package
```

Then test in VS Code with multiple integrated terminals.
