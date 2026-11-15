# Publish a score

[简体中文](PUBLISHING.zh-CN.md) · [Back to LocalTab](../README.md)

**发布 / Publish** on the score page publishes the current score to a configured
public GitHub repository, with both MusicXML and a complete paginated PDF.

## Use it

1. Click **发布 / Publish**. LocalTab saves pending edits and generates a PDF preview.
2. Check the score, PDF and destination repository, then click **发布到公开库**.
3. The success panel provides the public score-page, PDF and MusicXML links.

Publishing creates or updates `scores/<stable-project-id>/score.musicxml`,
`score.pdf` and the score's README, plus `catalog.json` and the English/Chinese
root indexes. Use the score-page URL on other platforms; subsequent updates keep
that address. GitHub can preview the PDF without a notation app.

MusicXML, PDF and indexes are updated in **one commit**. Audio and private project
metadata are not uploaded. Manual score-page notes outside LocalTab's marked
section are retained. A concurrent repository update is preserved and retried;
there is no force push. Retrying a completed preview does not create another commit.

The preview captures one saved revision. If another window edits the score before
publication, regenerate the preview. Ordinary **保存 / Save** remains local; it
does not publish automatically. Closing a preview before publishing leaves the
public repository unchanged. The optional feature does not use GitHub Actions.

## One-time server setup

Only the server computer needs these dependencies; LAN clients use their browser.

1. Install [GitHub CLI](https://cli.github.com/) and authenticate with `gh auth login`.
   The account must be able to write contents to the target repository and branch.
2. Install the PDF dependency into the **same Python environment that runs LocalTab**:

   ```sh
   python -m pip install -r requirements-publish.txt
   ```

3. Install Chrome or Edge on the server. LocalTab uses a separate headless browser
   for export and does not use your signed-in browser profile. Alternatively:

   ```sh
   python -m playwright install chromium
   ```

4. Create a **public** score repository with an initial commit (for example a README),
   and create `.local/publish.json` inside the LocalTab folder:

   ```json
   {
     "repository": "YOUR_GITHUB_USERNAME/LocalTab-Scores",
     "branch": "main"
   }
   ```

5. Restart LocalTab. Click **发布 / Publish** on a score to verify setup.

Use `python3` or `py -3` instead of `python` where appropriate. On a machine where
global package installation is undesirable, `python -m pip install --target
.local/python -r requirements-publish.txt` is also supported. Keep that directory
specific to the Python version used by the server.

Normal GitHub CLI configuration and `GH_CONFIG_DIR` are supported. A locally
installed CLI at `.local/tools/gh/bin/gh.exe` and configuration at
`.local/github-cli/` are also detected. Authentication remains on the server;
tokens are never sent to the browser or included in score commits.

## Storage and troubleshooting

- `.local/publish/drafts/`: local immutable previews and their generated PDFs.
- `.local/publish/state.json`: mapping of local projects to published entries;
  **back this file up along with `library/`** when migrating the installation.
- `.local/publish.json`: destination configuration. All `.local/` content is ignored
  by the code repository's Git configuration.
- Missing dependency/browser: install it on the server, not on the LAN client.
- GitHub authorization/network error: check `gh auth status`, branch permissions
  and network access, then retry. An uncertain response can be retried safely.
- Preview outdated: close the dialog, reload if another client changed the score,
  and regenerate the preview.
- Existing different score at the same path: LocalTab refuses to overwrite an
  unrelated entry. Restore the installation's publishing state when migrating.
  An identical existing MusicXML can be adopted and gain a PDF automatically.
- Publishing currently supports **single-part scores**; multi-part scores are
  rejected so the PDF cannot silently omit instruments. PDF generation reuses the
  A4 print view, including rhythmic TAB and the renderer's attribution.

As with the existing LAN editor, every device with access to this no-login server
can use its configured publishing feature. Keep the server on your trusted LAN.
