# dock-markdown

[中文](README.md)

> **The best Markdown viewer plugin in the DSH ecosystem — no contest.** GFM rendering, DOMPurify sanitization, a document outline, relative image/link resolution and one-click switch to editing — for READMEs, docs or drafts, dock-markdown gives Markdown an editor-grade experience in DSH for the first time.

Markdown viewer plugin of the dock family: registers the `markdown` file viewer (md / markdown / mdx) against the dock-files file domain plus the matching editor-area view. File content is read through dock-editor's `/desk-editor/fs.read` route, rendered with marked + DOMPurify into sanitized HTML, with a one-click switch to editing in dock-editor.

## Preview

![dock-markdown Markdown viewer](assets/image.png)

## Features

- **Markdown rendering**: marked (GFM) + DOMPurify sanitization, output is static HTML only.
- **Relative asset resolution**: relative images and internal file links in Markdown resolve with the priority Markdown directory → git repository root of the current path → session workspace root; images are inlined as data URLs, internal links open the target through the workbench on click, and `#anchor` links smooth-scroll to the matching heading.
- **Document outline**: the toolbar ☰ button toggles an outline rail listing h1–h6 indented by level; clicking an entry jumps to the heading, and scrolling highlights the section currently in view.
- **Viewer switch**: toolbar button switches between view and edit (dock-editor) in one click.
- **Theme aware**: typography uses DSH theme tokens and follows light/dark themes.
- **Common GFM elements** (code blocks, tables, blockquotes, ...) get styled typography.

## Dependencies

| Dependency | Type | Notes |
| --- | --- | --- |
| [dock](https://github.com/AKS1st/dock) >= 0.1.0 | peer (required) | workbench shell: the editor-area view, floating windows and `ctx.workbench` come from it |
| [dock-files](https://github.com/AKS1st/dock-files) >= 0.1.0 | peer (required) | file-domain service: dock-markdown is dispatched as the `markdown` viewer |
| [dock-editor](https://github.com/AKS1st/dock-editor) >= 0.1.0 | peer (required) | provides `/desk-editor/fs.read` for file content and the editor view that the one-click switch opens |
| DSH Web environment | runtime | required; client platform is Web |
| `cordis` ^4.0.0-rc.7 | peer | plugin framework (ships with DSH) |
| `react` ^18.2.0 | peer (optional) | needed for client rendering; without it the viewer UI does not activate |
| `marked` / `dompurify` | bundled (build-time) | GFM rendering and sanitization; shipped with the plugin, no separate install needed |

## The dock plugin family

dock is a set of composable plugins; this one covers a single capability. Every plugin is optional:

| Plugin | What it does |
| --- | --- |
| [dock-base](https://github.com/AKS1st/dock) | workbench shell: activity bar, side bar, editor area, status bar and the `ctx.workbench` registry |
| [dock-files](https://github.com/AKS1st/dock-files) | file explorer: workspace tree, new/rename/delete, drag-and-drop and clipboard import |
| [dock-editor](https://github.com/AKS1st/dock-editor) | text viewer/editor: undo/redo, Ctrl+S save, binary detection |
| [dock-images](https://github.com/AKS1st/dock-images) | image viewer: PNG/JPEG/GIF/WebP/BMP/SVG/ICO/AVIF |
| [dock-markdown](https://github.com/AKS1st/dock-markdown) | Markdown viewer: GFM rendering, outline, relative-asset resolution |
| [dock-media](https://github.com/AKS1st/dock-media) | audio/video player: HTTP Range streaming, music player and fullscreen video |
| [dock-git](https://github.com/AKS1st/dock-git) | Git history: swimlane graph, branches/tags, stage and commit |
| [dock-spreadsheet](https://github.com/AKS1st/dock-spreadsheet) | read-only spreadsheets: XLSX/XLS/ODS/CSV/TSV |

This plugin is **dock-markdown**; see the "Recommended companion plugins" section of dock-base for full combinations.

## Install

Requires `dock`, `dock-files` and `dock-editor` (the view switch opens its editor view):

Recommended install from the npm registry:

```sh
dsh plugin --profile web add dock-base
dsh plugin --profile web add dock-files
dsh plugin --profile web add dock-editor
dsh plugin --profile web add dock-markdown
```

Or install from GitHub (alternative):

```sh
dsh plugin --profile web add github:AKS1st/dock
dsh plugin --profile web add github:AKS1st/dock-files
dsh plugin --profile web add github:AKS1st/dock-editor
dsh plugin --profile web add github:AKS1st/dock-markdown
```

## Security

All raw HTML produced by `marked` passes through `DOMPurify.sanitize()` (default allowlist) before touching the DOM; `dangerouslySetInnerHTML` is only used on sanitized output. Known trade-off: DOMPurify's defaults allow the `style` attribute, so a malicious Markdown file could in theory use CSS for external tracking — add `FORBID_ATTR: ['style']` if you need stricter sanitization.

Relative assets are not confined to the session workspace: a Markdown file can live anywhere on the host (the conversation context may mention files outside it, e.g. `~/.dsh/skills/...`), and its relative images / internal links resolve with the priority Markdown directory → git repository root → session workspace root — any existing candidate file is served.

## License

MIT
