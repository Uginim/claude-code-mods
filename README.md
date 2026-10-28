<div align="center">

# claude-code-mods

**Three small mods for [Claude Code](https://claude.com/claude-code): a log of what Claude created, a log of what it edited, and export buttons for the tables in its replies.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Mods](https://img.shields.io/badge/mods-3-8A63D2)
![Claude Code](https://img.shields.io/badge/Claude%20Code-hooks%20module-D97757)
![Status](https://img.shields.io/badge/status-early%20access%20API-orange)

[Mods](#mods) · [Install](#install) · [creation-log](#creation-log) · [edit-diff-log](#edit-diff-log) · [table-export](#table-export) · [Limitations](#known-limitations) · [Development](#development)

</div>

---

## Mods

| Mod | What it adds | Command | Opens by itself |
| --- | --- | --- | --- |
| [**creation-log**](#creation-log) | A **Creations** pane listing new files Claude wrote and links it published | `/creations` | Yes, when a session starts |
| [**edit-diff-log**](#edit-diff-log) | An **Edit diffs** pane listing every file edit, each with its diff | `/edit-diffs` | No |
| [**table-export**](#table-export) | `Copy table n` / `Save table n CSV` buttons right under each markdown table in a reply | none | n/a |

Each mod is a single hooks module (`hooks/register.tsx`) with its own tests. Install only the ones you want.

## Install

At the prompt of a Claude Code terminal session:

```text
/plugin install creation-log --marketplace Uginim/claude-code-mods
/plugin install edit-diff-log --marketplace Uginim/claude-code-mods
/plugin install table-export --marketplace Uginim/claude-code-mods
```

The first time, Claude Code asks `Add marketplace?` for `github:Uginim/claude-code-mods`: answer `y`, then pick a scope (user scope is listed first; press Enter).

From a shell:

```bash
claude plugin install creation-log --marketplace Uginim/claude-code-mods
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box → **Plugins** → **Add marketplace** with `Uginim/claude-code-mods` → **Add plugin**.

### Update

```bash
claude plugin update <mod>
```

Then run `/reload-plugins` in an open session, or start a new one.

---

## creation-log

> Keeps a list of the files and links Claude created, so you can find them after the conversation has scrolled away.

```text
┌ Creations ─────────────────────────────────────────┐
│ [Close]                                            │
│ 14:02:51 link gist.github.com/…/3f9c2a             │
│ 14:01:10 file README.md                            │
│   /Users/me/projects/demo/README.md                │
│ 13:58:42 file notes.md [9b1e]                      │
└────────────────────────────────────────────────────┘
  (illustration; press a row to show or hide its full path or URL)
```

**What it records**

- **New files** written with the `Write` tool (only when the result is a *create*; overwriting an existing file is not recorded).
- **Links** printed by `gh gist create`, `gh pr create`, `gh issue create`, `gh release create` and `gh repo create`.
- **claude.ai links** returned when an Artifact is published.

**How it works**

- The pane opens when a session starts. `/creations` closes it or opens it again; `Esc` or the **Close** button closes it too.
- Rows are newest first. Pressing a row shows its full path or URL; pressing it again hides it.
- The list is shared by all your sessions and keeps the latest 500 entries. A row made in another session carries the first four characters of that session's id, for example `[9b1e]`.

**Not recorded:** files created by shell commands (`touch`, `cp`, redirects, …), and links from CLIs other than `gh`.

## edit-diff-log

> A running history of the edits Claude made, with the diff of each, kept across sessions and for files outside git.

```text
┌ Edit diffs ────────────────────────────────────────┐
│ [Close]                                            │
│ 14:05:33 register.tsx +12 -3                       │
│   /Users/me/projects/demo/hooks/register.tsx       │
│   @@ -40,6 +40,15 @@                               │
│   -  const KEEP = 100                              │
│   +  const KEEP = 200                              │
│   …                                                │
│ 14:03:02 README.md +1 -1 [9b1e]                    │
└────────────────────────────────────────────────────┘
  (illustration; press a row to show or hide its diff)
```

**What it records**

- Every successful `Edit`.
- `Write` calls that overwrite an existing file (new files belong to creation-log).

**How it works**

- `/edit-diffs` opens or closes the pane. It does not open by itself.
- Each row shows the file name and the added / removed line counts. Pressing it shows the full path and a unified diff.
- The list is shared by all your sessions and keeps the latest 100 edits. Each diff keeps whole hunks up to 20,000 characters; when the first hunk alone is larger, the row shows `Diff too large to show.`

**Not recorded:** `NotebookEdit`, and edits made by shell commands (`sed -i`, scripts, …).

**Compared with the built-in `/diff`:** `/diff` shows the working tree's changes. This mod keeps a per-edit history, also for files outside a git repository, and keeps it after the session ends.

## table-export

> Moves a markdown table from a reply into a spreadsheet in one press.

```text
  | name | score |
  |------|-------|
  | kim  | 92    |
  | lee  | 88    |

  [Copy table 1] [Save table 1 CSV]
```

- **Copy table n** copies the table as TSV, so it pastes into separate spreadsheet cells.
- **Save table n CSV** writes `claude-table-YYYYMMDD-HHMMSS.csv` to `~/Downloads`, UTF-8 with a BOM so spreadsheet apps detect the encoding (non-ASCII text such as Korean stays readable). A toast shows the saved path.
- **CSV folder** (`saveDir`): set it in `/config` or when installing. An absolute path or one starting with `~/`; empty means `~/Downloads`. The folder must already exist; if the write fails, a toast says why.
- Cell clean-up: `**bold**`, `__bold__` and backticks are dropped, `<br>` becomes a space, `\|` becomes `|`.

**Where the buttons go:** right under the table they belong to. The text up to the first table is drawn by Claude Code itself; the text after it is drawn again by the mod's markdown element, so it may look slightly different there.

**Which tables count:** tables whose rows start and end with `|`, followed by a separator row. Tables inside fenced code blocks and summary blocks get no buttons.

**Compared with the built-in `/copy`:** `/copy` copies a whole reply as markdown. This mod works per table and outputs TSV or CSV.

---

## Known limitations

- **Early access API.** These mods use Claude Code's hooks module API, which is marked early access and may change between releases.
- **Screen may stop responding with a pane open.** This has been reported with the panes of creation-log and edit-diff-log; the cause has not been identified yet. If it happens to you, please [open an issue](https://github.com/Uginim/claude-code-mods/issues) with your Claude Code version and terminal.
- **No lock on the shared list.** If two sessions record an entry at the same instant, one entry can be lost.
- **Not tested on every surface.** The automated tests render the terminal and desktop surfaces; other surfaces have not been tried.

## Development

```text
.
├── .claude-plugin/marketplace.json   # lists the three mods
└── plugins/
    ├── creation-log/
    │   ├── .claude-plugin/plugin.json
    │   ├── hooks/{hooks.json,register.tsx}
    │   ├── types/index.d.ts           # $.state contract
    │   └── tests/
    ├── edit-diff-log/                 # same layout
    └── table-export/                  # same layout, no state contract
```

Run a mod from a local checkout without installing it:

```bash
claude --plugin-dir plugins/creation-log
```

Check and test a mod:

```bash
claude plugin validate plugins/creation-log
claude plugin test plugins/creation-log
```

`tsconfig.json` in each mod extends `.claude-plugin/types/tsconfig.json`, which Claude Code writes when it loads the mod; after that, `tsc -p plugins/<mod>` type-checks it.

Issues and pull requests are welcome.

## License

[MIT](LICENSE)
