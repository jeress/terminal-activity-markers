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
code --install-extension terminal-activity-markers-0.2.6.vsix --force
```

Reload the VS Code window after installation.

## Design Constraints

The extension must stay within stable VS Code extension APIs.

Do not add behavior that:

- closes terminals automatically;
- depends on undocumented VS Code internals;
- repeatedly sweeps or focuses all terminals during ordinary click/focus changes;
- claims native terminal row coloring, decoration, sorting, or reordering.

The native Terminal Explorer markers are implemented by renaming terminal sessions. VS Code only exposes a command to rename the active terminal, so full refresh behavior must remain explicit and conservative.

## Before Opening A Pull Request

Run:

```sh
npm test
npm run package
```

Then test in VS Code with multiple integrated terminals.
