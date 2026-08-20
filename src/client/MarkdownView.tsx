/**
 * Markdown view: renders the file carried by the open seed as sanitized
 * Markdown HTML.
 * - file content is read through dock-editor's /desk-editor/fs.read host
 *   route (same-origin fetch, POST { sessionId, path }), exactly like
 *   EditorView
 * - marked (GFM) renders Markdown → HTML; DOMPurify sanitizes it against XSS
 * - toolbar (title + "open in editor" switch button) sits below the floating
 *   window title bar; the switch button opens dock-editor's 'editor' view
 *   for the same file (floating), implementing the view→edit conversion
 */
import { createElement, useEffect, useState, type ReactNode } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { ViewProps, WorkbenchService } from './contract.ts'

/** The seed shape the file domain dispatches (EditorOpenSeed). */
interface OpenSeed {
  path?: string
  title?: string
  meta?: unknown
}

interface ReadResponse {
  ok: boolean
  value?: { file: { content: string; truncated: boolean; binary: boolean; size: number } }
  error?: { code: string; message: string }
}

const INLINE = {
  wrap: { padding: '12px 16px', height: '100%', boxSizing: 'border-box' as const, display: 'flex', flexDirection: 'column' as const },
  head: { display: 'flex', alignItems: 'center', gap: 4, paddingBottom: 8, borderBottom: '1px solid var(--dsw-alias-border-l2, #d8dbe0)', marginBottom: 10, fontSize: 12, color: 'var(--dsw-alias-label-secondary, #656d76)' } as const,
  title: { fontWeight: 600, color: 'var(--dsw-alias-label-primary, #1f2328)', overflow: 'hidden', textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const, marginLeft: 8, flex: 1 },
  switchBtn: { border: '1px solid var(--dsw-alias-border-l2, #d8dbe0)', background: 'transparent', color: 'var(--dsw-alias-label-primary, #1f2328)', borderRadius: 5, padding: '2px 9px', cursor: 'pointer', fontSize: 13, lineHeight: 1.45 } as const,
  scroll: { flex: 1, minHeight: 0, overflow: 'auto' as const },
  err: { color: '#d1242f', fontSize: 13 },
  empty: { color: 'var(--dsw-alias-label-secondary, #656d76)', fontSize: 13 },
}

/** Markdown typography, scoped under the .dock-md container class (theme tokens). */
const MD_CSS = `
.dock-md { line-height: 1.7; font-size: 14px; color: var(--dsw-alias-label-primary, #1f2328); word-break: break-word; }
.dock-md h1, .dock-md h2, .dock-md h3, .dock-md h4 { margin: 0.9em 0 0.45em; line-height: 1.35; color: var(--dsw-alias-label-primary, #1f2328); }
.dock-md h1 { font-size: 1.5em; border-bottom: 1px solid var(--dsw-alias-border-l2, #d8dbe0); padding-bottom: 0.25em; }
.dock-md h2 { font-size: 1.3em; border-bottom: 1px solid var(--dsw-alias-border-l2, #d8dbe0); padding-bottom: 0.2em; }
.dock-md h3 { font-size: 1.15em; }
.dock-md h4 { font-size: 1.05em; }
.dock-md p { margin: 0.5em 0; }
.dock-md a { color: var(--dsw-alias-interactive-fg-accent, #3b6fe0); text-decoration: none; }
.dock-md a:hover { text-decoration: underline; }
.dock-md code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.06)); padding: 0.15em 0.35em; border-radius: 4px; color: var(--dsw-alias-label-primary, #1f2328); }
.dock-md pre { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.06)); padding: 10px 12px; border-radius: 6px; overflow: auto; }
.dock-md pre code { background: transparent; padding: 0; font-size: 0.92em; }
.dock-md blockquote { margin: 0.6em 0; padding-left: 0.9em; border-left: 3px solid var(--dsw-alias-border-l2, #d8dbe0); color: var(--dsw-alias-label-secondary, #656d76); }
.dock-md ul, .dock-md ol { padding-left: 1.5em; margin: 0.5em 0; }
.dock-md li { margin: 0.2em 0; }
.dock-md img { max-width: 100%; }
.dock-md hr { border: 0; border-top: 1px solid var(--dsw-alias-border-l2, #d8dbe0); margin: 1em 0; }
.dock-md table { border-collapse: collapse; margin: 0.6em 0; }
.dock-md th, .dock-md td { border: 1px solid var(--dsw-alias-border-l2, #d8dbe0); padding: 4px 10px; }
.dock-md th { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.06)); }
`

export function MarkdownView(props: ViewProps): ReactNode {
  const { ctx, sessionId, seed } = props
  const openSeed = (seed ?? {}) as OpenSeed
  const path = openSeed.path

  const [content, setContent] = useState<string | null>(null)
  const [binary, setBinary] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [html, setHtml] = useState<string | null>(null)

  // Load the file when the seed path changes (same route as dock-editor).
  useEffect(() => {
    if (path === undefined) return
    let cancelled = false
    setContent(null)
    setHtml(null)
    setError(null)
    setBinary(false)
    setTruncated(false)
    void (async () => {
      try {
        const response = await fetch('/desk-editor/fs.read', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, path }),
        })
        const json = (await response.json()) as ReadResponse
        if (json.ok !== true || json.value === undefined) {
          throw new Error(json.error?.message ?? 'read failed')
        }
        if (cancelled) return
        const file = json.value.file
        setContent(file.content)
        setBinary(file.binary)
        setTruncated(file.truncated)
      } catch (cause) {
        if (cancelled) return
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()
    return () => { cancelled = true }
  }, [path, sessionId])

  // Render Markdown → sanitized HTML once the content is available.
  useEffect(() => {
    if (content === null || binary) {
      setHtml(null)
      return
    }
    try {
      const raw = marked.parse(content, { async: false, gfm: true, breaks: true }) as string
      setHtml(DOMPurify.sanitize(raw))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setHtml(null)
    }
  }, [content, binary])

  // Toolbar switch: open the same file in dock-editor's 'editor' view
  // (registered id 'editor', the default viewer), floating like this one.
  const switchToEditor = (): void => {
    if (path === undefined) return
    const title = openSeed.title ?? path.split('/').pop() ?? path
    ctx.get<WorkbenchService>('workbench')?.openView('editor', { path, title }, { floating: true })
  }

  const title = openSeed.title ?? path?.split('/').pop() ?? 'No file'

  return createElement('div', { style: INLINE.wrap },
    // Scoped markdown typography (removed with the component on unmount).
    createElement('style', { dangerouslySetInnerHTML: { __html: MD_CSS } }),
    createElement('div', { style: INLINE.head },
      createElement('button', {
        style: INLINE.switchBtn,
        title: '用编辑器打开',
        onClick: switchToEditor,
      }, '✎'),
      createElement('span', { style: INLINE.title, title: path }, title),
      truncated
        ? createElement('span', { style: INLINE.empty }, '（文件过大，仅显示前 256 KiB）')
        : null,
    ),
    error !== null
      ? createElement('div', { style: INLINE.err }, error)
      : content === null
        ? createElement('div', { style: INLINE.empty }, 'Reading…')
        : binary
          ? createElement('div', { style: INLINE.err }, 'Binary file — markdown preview is not supported.')
          : createElement('div', { style: INLINE.scroll },
            createElement('div', {
              className: 'dock-md',
              dangerouslySetInnerHTML: { __html: html ?? '' },
            }),
          ),
  )
}
