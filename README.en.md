# dock-markdown

[中文](README.md)

Markdown viewer plugin of the dock family: registers the `markdown` file viewer (md / markdown / mdx) against the dock-files file domain plus the matching editor-area view. File content is read through dock-editor's `/desk-editor/fs.read` route, rendered with marked + DOMPurify into sanitized HTML, with a one-click switch to editing in dock-editor.

## Features

- **Markdown rendering**: marked (GFM) + DOMPurify sanitization, output is static HTML only.
- **Viewer switch**: toolbar button switches between view and edit (dock-editor) in one click.
- **Theme aware**: typography uses DSH theme tokens and follows light/dark themes.
- **Common GFM elements** (code blocks, tables, blockquotes, ...) get styled typography.

## Install

Requires `dock`, `dock-files` and `dock-editor` (the view switch opens its editor view):

```sh
dsh plugin add github:AKS1st/dock
dsh plugin add github:AKS1st/dock-files
dsh plugin add github:AKS1st/dock-editor
dsh plugin add github:AKS1st/dock-markdown
```

## Security

All raw HTML produced by `marked` passes through `DOMPurify.sanitize()` (default allowlist) before touching the DOM; `dangerouslySetInnerHTML` is only used on sanitized output. Known trade-off: DOMPurify's defaults allow the `style` attribute, so a malicious Markdown file could in theory use CSS for external tracking — add `FORBID_ATTR: ['style']` if you need stricter sanitization.

## License

MIT
