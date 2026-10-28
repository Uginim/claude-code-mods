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
| [**table-export**](#table-export) | A main export button and a **More** button right under each markdown table in a reply | none | n/a |

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
│ [Close] [This session] [All sessions]              │
│ This session · 1 file, 1 link                      │
│ 14:02:51 link gist.github.com/…/3f9c2a             │
│ 14:01:10 file README.md                            │
│   /Users/me/projects/demo/README.md                │
│   [Open] [Show in folder] [Copy path]              │
│ ▸ 10-27 18:20 · demo · 3 files [9b1e]              │
│ ▸ 10-26 09:12 · notes · 1 file, 2 links [41c0]     │
└────────────────────────────────────────────────────┘
  (illustration; press a row to show or hide its full path and buttons,
   press a session line to show or hide its entries)
```

**What it records**

- **New files** written with the `Write` tool (only when the result is a *create*; overwriting an existing file is not recorded).
- **Links** printed by `gh gist create`, `gh pr create`, `gh issue create`, `gh release create` and `gh repo create`.
- **claude.ai links** returned when an Artifact is published.

**How it works**

- The pane opens when a session starts. `/creations` closes it or opens it again; `Esc` or the **Close** button closes it too.
- **This session** / **All sessions** at the top choose what the pane lists: only this session's entries, or this session's followed by the earlier ones. The highlighted button is the current choice; it is kept across sessions, and *All sessions* is the default. With *This session*, a dim line says how many earlier sessions are hidden.
- Entries are grouped by session. The current session comes first and is always open; each earlier session is one line with the time of its oldest kept entry, the folder it ran in, how many files and links it has, and the first four characters of its id, for example `[9b1e]`. Pressing that line shows its entries; pressing it again, or another session's line, hides them.
- Rows are newest first. Pressing a row shows its full path or URL and these buttons; pressing it again hides them:
  - **Open**: opens the file or link with the system's default app (`open` on macOS, `xdg-open` where `open` is missing). Not offered for files that run when opened, such as `.app`, `.command`, `.sh` or `.pkg`.
  - **Show in folder** (files): reveals the file in Finder on macOS, or opens its folder with `xdg-open`.
  - **Copy path** / **Copy URL**.
  - A toast says so when a command fails, for example because the file was moved or deleted.
- The list is shared by all your sessions and keeps the latest 500 entries. Entries recorded by version 0.1.0 have no folder; ones without a session id are grouped under *Unknown session*.

**Not recorded:** files created by shell commands (`touch`, `cp`, redirects, …), and links from CLIs other than `gh`.

## edit-diff-log

> A running history of the edits Claude made, with the diff of each, kept across sessions and for files outside git.

```text
┌ Edit diffs ────────────────────────────────────────┐
│ [Close] [This session] [All sessions]              │
│ This session · 2 edits +13 -4                      │
│ 14:05:33 register.tsx +12 -3                       │
│   /Users/me/projects/demo/hooks/register.tsx       │
│   [Copy path]                                      │
│   @@ -40,6 +40,15 @@                               │
│   -  const KEEP = 100                              │
│   +  const KEEP = 200                              │
│   …                                                │
│ 14:03:02 README.md +1 -1                           │
│ ▸ 10-27 18:20 · demo · 5 edits +40 -12 [9b1e]      │
└────────────────────────────────────────────────────┘
  (illustration; press a row to show or hide its diff,
   press a session line to show or hide its edits)
```

**What it records**

- Every successful `Edit`.
- `Write` calls that overwrite an existing file (new files belong to creation-log).

**How it works**

- `/edit-diffs` opens or closes the pane. It does not open by itself.
- Edits are grouped by session, the same way as in creation-log: the current session first and open, each earlier session as one line (time, folder, number of edits, total added / removed lines, id) that shows its edits when pressed.
- **This session** / **All sessions** at the top work as in creation-log; the choice is kept separately for each pane.
- Each row shows the file name and the added / removed line counts. Pressing it shows the full path, a **Copy path** button and a unified diff.
- The list is shared by all your sessions and keeps the latest 100 edits. Each diff keeps whole hunks up to 20,000 characters; when the first hunk alone is larger, the row shows `Diff too large to show.`

**Not recorded:** `NotebookEdit`, and edits made by shell commands (`sed -i`, scripts, …).

**Compared with the built-in `/diff`:** `/diff` shows the working tree's changes. This mod keeps a per-edit history, also for files outside a git repository, and keeps it after the session ends.

## table-export

> Moves a markdown table from a reply into a spreadsheet, a document or an image in one or two presses.

```text
  | name | score |
  |------|-------|
  | kim  | 92    |
  | lee  | 88    |

  [Copy table 1 TSV] [More]

  after pressing More:
  [Copy table 1 TSV] [Less] [Save CSV] [Copy MD] [Copy art] [Copy HTML] [Copy PNG]
```

Each table gets one **main button** and a **More** button. More shows the other formats; pressing one of them runs it and hides the row again.

| Format | What it does | Where it works |
| --- | --- | --- |
| `tsv` | Copies the table as tab-separated text, so it pastes into separate spreadsheet cells | Any surface with a clipboard |
| `csv` | Writes `claude-table-YYYYMMDD-HHMMSS.csv` to the CSV folder, UTF-8 with a BOM so spreadsheet apps detect the encoding (non-ASCII text such as Korean stays readable); a toast shows the path | Anywhere |
| `md` | Copies the table's original markdown lines | Any surface with a clipboard |
| `art` | Copies the table drawn with box-drawing characters (`┌─┬─┐`); wide characters such as Korean count as two columns so the lines stay aligned in a monospaced font | Any surface with a clipboard |
| `html` | Puts an HTML table on the clipboard, with TSV as its plain-text form, so rich editors paste a table | macOS (`osascript`); elsewhere the HTML source is copied as text and a toast says why |
| `png` | Puts an image of the table on the clipboard | macOS (`osascript`); elsewhere a toast says it was not copied |

**Settings** (in `/config`, or when installing):

- **Main button** (`defaultFormat`): which format the main button runs. One of `tsv`, `csv`, `md`, `art`, `html`, `png`; `tsv` by default. The other five stay under More.
- **CSV folder** (`saveDir`): an absolute path or one starting with `~/`; empty means `~/Downloads`. The folder must already exist; if the write fails, a toast says why.

Cell clean-up (all formats except `md`): `**bold**`, `__bold__`, `*emphasis*`, `~~strikethrough~~` and backticks lose their marks, `[text](url)` keeps only its text, `<br>` becomes a space, `\|` becomes `|`. Underscores inside words, as in `snake_case`, are kept.

Column alignment from the separator row (`:---`, `:---:`, `---:`) is kept in `art` (padding), `html` (`text-align`) and `png`.

In `tsv`, a cell that contains `"` is wrapped in quotes with the inner quotes doubled, so a spreadsheet keeps the quote marks.

**Where the buttons go:** right under the table they belong to. The text up to the first table is drawn by Claude Code itself; the text after it is drawn again by the mod's markdown element, so it may look slightly different there.

**Which tables count:** a header row, then a separator row with the same number of cells, then the body rows; the outer `|` on each row is optional. A separator needs at least one `|`, so a lone `---` stays a horizontal rule. Tables inside fenced code blocks (a fence closes only with the same character, at least as long as the opening one) and summary blocks get no buttons.

**Compared with the built-in `/copy`:** `/copy` copies a whole reply as markdown. This mod works per table and offers the formats above.

---

## Known limitations

- **Early access API.** These mods use Claude Code's hooks module API, which is marked early access and may change between releases.
- **Screen may stop responding with a pane open.** This has been reported with the panes of creation-log and edit-diff-log; the cause has not been identified yet. If it happens to you, please [open an issue](https://github.com/Uginim/claude-code-mods/issues) with your Claude Code version and terminal.
- **No lock on the shared list.** If two sessions record an entry at the same instant, one entry can be lost.
- **One copy of the session grouping code per mod.** creation-log and edit-diff-log are installed separately, so each carries its own copy of the grouping helper.
- **`html` and `png` use macOS only.** Elsewhere `html` copies the HTML source as text and `png` is not copied.
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
    └── table-export/                  # same layout
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
