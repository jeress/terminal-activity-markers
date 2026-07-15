# Release Checklist

Public releases use semantic versions such as `1.0.0`, a matching `v1.0.0` Git tag, and a GitHub Release with the packaged VSIX attached.

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
   - manual `Terminal Activity Monitor: Refresh Native Terminal Names`;
   - no Terminal Activity view appears in Explorer;
   - the selected terminal is green while untouched migrated terminals begin yellow.

8. Commit and tag the release:

   ```sh
   git commit -am "Release v<version>"
   git tag -a v<version> -m "Terminal Activity Monitor for VS Code v<version>"
   git push origin main v<version>
   ```

9. Create the GitHub release and attach the VSIX:

   ```sh
   gh release create v<version> terminal-activity-markers-<version>.vsix \
     --title "Terminal Activity Monitor for VS Code v<version>" \
     --generate-notes --verify-tag
   ```

## Marketplace Publishing

This extension can be published with `vsce publish` once the `jeress` Marketplace publisher is configured.

Until then, publish GitHub releases with attached VSIX files and keep the README's GUI installation steps current.
