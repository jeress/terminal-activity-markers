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
   - confirm generic `Terminal` labels show only the dot or the captured session name, custom names remain intact, and clearing markers restores the original name;
   - in a fresh profile with shell integration, start an application after activation and confirm its title appears beside the activity dot and updates after a fixed-name rename;
   - confirm custom terminal names remain intact, the `applicationTitles` switch hides/restores titles, and disabling markers clears the appended title;
   - focus switching between terminals;
   - one terminal used within the active window;
   - one terminal older than the active window;
   - manual `Terminal Activity Monitor: Refresh Native Terminal Names`;
   - no Terminal Activity view appears in Explorer;
   - clicking between terminals does not change their dots;
   - a new shell command turns its terminal green while untouched migrated terminals begin white;
   - output or substantial CPU activity turns the correct terminal green;
   - no double-green, completion, or failure markers appear.
   - keep the terminal panel hidden and type in an editor across several polling cycles; the panel stays hidden and keyboard focus stays in the editor;
   - a full refresh with unchanged names does not reveal or switch terminals;
   - background dots update on selection without recording new activity;
   - select a different terminal during a full refresh; the sweep stops and preserves that selection;
   - rename a terminal to `Active project`; automatic and manual refreshes preserve the name;
   - disable and clear markers while a refresh is pending; no queued update adds dots again;
   - close a terminal during a full refresh; no unrelated terminal is renamed;
   - reload the same workspace with surviving terminal processes and confirm timestamps are restored;
   - test long-running output on macOS, Linux, and Windows, including an available SSH or container extension host.

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
