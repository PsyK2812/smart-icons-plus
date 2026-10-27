# Smart Icons Plus

A fork of [Smart Icons](https://github.com/jofelicio/smart-icons) by Jorge Felício (MIT).

Works exactly like Smart Icons — a **Smart Icons** button on item sheets opens an icon picker, and on actor sheets it walks through every item — but it also searches the file names of **every image in your server's Data folder**, not just core icons, the current system and modules.

## What's different from the original

- **Scans the whole user Data folder**: worlds, your uploaded assets, any custom folders, all modules. (The original only looked in `icons/`, `systems/<your system>/` and `modules/`.)
- Uppercase extensions (`.PNG`, `.JPG`) are recognized; file names are split on spaces, dashes, underscores, dots and brackets.
- **Rescan** button in the picker — use it after uploading new images.
- Shows the full path of the selected image, and the path as a tooltip on hover.
- Settings (Game Settings → Configure Settings → Smart Icons Plus):
  - Scan the whole Data folder (on by default)
  - Extra folders to scan (when the above is off)
  - Folders to ignore (e.g. big map packs)
  - Also match folder names (off by default)
  - S3 bucket (optional)
  - Maximum results shown (default 30)
- Faster crawling (folders are browsed in parallel) and faster fuzzy matching. Scoring rules are unchanged.
- Macro API: `game.modules.get("smart-icons-plus").api.reindex()` and `.api.search("flaming sword")`.

## Install

**Manifest URL** (Add-on Modules → Install Module):

```
https://github.com/PsyK2812/smart-icons-plus/releases/latest/download/module.json
```

Or manually:

1. Unzip so you get a folder named `smart-icons-plus` (containing `module.json`).
2. Put it in your Foundry user Data folder under `Data/modules/`.
3. Restart Foundry, then enable **Smart Icons Plus** in your world. Disable the original Smart Icons to avoid two header buttons.

Indexing runs in the background after the world loads (GM only). The first scan of a large Data folder can take a little while; the console (F12) shows how many files were indexed and how long it took.

## Releasing a new version

Push a tag like `v1.1.0` (or publish a GitHub release with that tag). The workflow sets the version in `module.json`, builds `module.zip` and attaches both to the release, so Foundry picks up the update.
