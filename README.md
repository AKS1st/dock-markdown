# dock-markdown

[English](README.en.md)

dock 系列的 Markdown 查看插件：为 dock-files 文件域注册 `markdown` 文件查看器（md / markdown / mdx）与对应的编辑器区视图。通过 dock-editor 的 `/desk-editor/fs.read` 读取文件内容，用 marked + DOMPurify 渲染为消毒后的 HTML，并提供一键切换到 dock-editor 编辑。

## 功能

- **Markdown 渲染**：marked（GFM）+ DOMPurify 消毒，输出纯静态 HTML。
- **查看器切换**：工具栏按钮一键在「查看」与「编辑」（dock-editor）之间切换。
- **主题适配**：排版样式使用 DSH 主题 token，跟随亮/暗主题。
- **代码块 / 表格 / 引用**等常用 GFM 元素均有排版样式。

## 安装

需要 `dock`、`dock-files` 与 `dock-editor`（查看器切换依赖其 editor 视图）：

```sh
dsh plugin add github:AKS1st/dock
dsh plugin add github:AKS1st/dock-files
dsh plugin add github:AKS1st/dock-editor
dsh plugin add github:AKS1st/dock-markdown
```

## 安全

`marked` 输出的原始 HTML 一律经 `DOMPurify.sanitize()`（默认白名单）消毒后才写入 DOM，`dangerouslySetInnerHTML` 只用于消毒后的结果。已知取舍：DOMPurify 默认允许 `style` 属性，恶意 Markdown 理论上可用 CSS 做外联跟踪——如需更严格可加 `FORBID_ATTR: ['style']`。

## License

MIT
