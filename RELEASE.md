# Release Checklist

1. Update `version` in `package.json`.
2. Update root package metadata in `package-lock.json`.
3. Add a `CHANGELOG.md` entry.
4. Run tests:

   ```sh
   npm test
   ```

5. Package the extension:

   ```sh
   npm run package
   ```

6. Install the VSIX locally and reload VS Code:

   ```sh
   code --install-extension terminal-activity-markers-<version>.vsix --force
   ```

7. Smoke-test:

   - several open terminals;
   - focus switching between terminals;
   - one terminal used within the active window;
   - one terminal older than the active window;
   - manual `Terminal Activity Dashboard: Refresh Native Terminal Names`.

8. Publish or attach the VSIX to a GitHub release.

## Marketplace Publishing

This extension can be published with `vsce publish` once the `jeress` Marketplace publisher is configured.

For now, prefer GitHub releases with attached VSIX files unless the Marketplace publisher setup is complete.
