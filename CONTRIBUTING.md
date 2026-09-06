# Contributing

Thanks for considering a contribution.

## Development Setup

```sh
npm ci
npm test
```

Use `npm run compile` for a one-off TypeScript build and `npm run watch` while editing.

## Local Extension Testing

Package and install a local VSIX:

```sh
npm run package
code --install-extension terminal-activity-markers-<version>.vsix --force
```

Reload the VS Code window after installation.

## Design Constraints

The extension must stay within stable VS Code extension APIs.

Do not add behavior that:

- closes terminals automatically;
- depends on undocumented VS Code internals;
- treats focus changes caused by its own rename sweeps as user activity;
- claims native terminal row coloring, decoration, sorting, or reordering.

The native terminal-list dots are implemented by renaming terminal sessions. Automatic updates must never reveal or select terminals. Explicit full refreshes may select terminals with `preserveFocus`, must verify each rename, and must stop if the user changes selection. Restore the original selection only when a sweep actually switched terminals and was not interrupted. Terminal selection never counts as activity.

Use Node.js 22 or later. Packaging runs the TypeScript build automatically. CI tests and packages on macOS, Linux, and Windows; local VS Code smoke tests are still needed to check actual panel and keyboard focus behavior.

## Before Opening A Pull Request

Run:

```sh
npm test
npm run package
```

Then test in VS Code with multiple integrated terminals.
