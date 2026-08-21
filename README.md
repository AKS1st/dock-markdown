# dock-markdown

[English](README.en.md)

> **DSH 生态中最好的 Markdown 查看插件 —— 没有之一。** GFM 渲染、DOMPurify 消毒、文档大纲、相对路径图片/链接解析、一键切编辑，读 README、看文档、审稿子，dock-markdown 让 Markdown 在 DSH 里第一次有了「编辑器级」体验。

dock 系列的 Markdown 查看插件：为 dock-files 文件域注册 `markdown` 文件查看器（md / markdown / mdx）与对应的编辑器区视图。通过 dock-editor 的 `/desk-editor/fs.read` 读取文件内容，用 marked + DOMPurify 渲染为消毒后的 HTML，并提供一键切换到 dock-editor 编辑。

## 效果预览

![dock-markdown Markdown 查看视图](assets/image.png)

## 功能

- **Markdown 渲染**：marked（GFM）+ DOMPurify 消毒，输出纯静态 HTML。
- **相对路径资源解析**：Markdown 中的相对图片与内部跳转链接按「Markdown 所在目录 → 当前路径所在 git 仓库根目录 → 会话工作区根目录」的优先级解析；图片以内联 data URL 展示，内部链接点击后通过工作台打开目标文件，`#锚点` 链接平滑滚动到对应标题。
- **文档大纲**：工具栏 ☰ 按钮展开/收起大纲栏，按标题层级缩进列出 h1–h6，点击跳转到对应标题，滚动时高亮当前所在章节。
- **查看器切换**：工具栏按钮一键在「查看」与「编辑」（dock-editor）之间切换。
- **主题适配**：排版样式使用 DSH 主题 token，跟随亮/暗主题。
- **代码块 / 表格 / 引用**等常用 GFM 元素均有排版样式。

## 依赖

| 依赖 | 类型 | 说明 |
| --- | --- | --- |
| [dock](https://github.com/AKS1st/dock) >= 0.1.0 | peer（必需） | 工作台外壳：编辑器区视图、浮窗、`ctx.workbench` 由它提供 |
| [dock-files](https://github.com/AKS1st/dock-files) >= 0.1.0 | peer（必需） | 文件域服务：dock-markdown 作为 `markdown` 查看器被分发打开 |
| [dock-editor](https://github.com/AKS1st/dock-editor) >= 0.1.0 | peer（必需） | 提供 `/desk-editor/fs.read` 读取文件内容，以及「一键切编辑」的目标编辑器视图 |
| DSH Web 环境 | 运行时 | 必需，客户端平台为 Web |
| `cordis` ^4.0.0-rc.7 | peer | 插件框架（DSH 自带） |
| `react` ^18.2.0 | peer（可选） | 客户端渲染需要；未提供时查看器 UI 不激活 |
| `marked` / `dompurify` | 内置（构建打包） | GFM 渲染与消毒，随插件打包，无需单独安装 |

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

相对路径资源不受会话工作区限制：Markdown 文件可能位于主机的任何位置（对话上下文可提及工作区外的文件，如 `~/.dsh/skills/...`），其相对图片 / 内部链接按「Markdown 所在目录 → git 仓库根目录 → 会话工作区根目录」优先级解析，只要候选是存在的文件即可读取。

## License

MIT
