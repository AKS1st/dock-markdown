/**
 * Markdown view: renders the file carried by the open seed as sanitized
 * Markdown HTML.
 * - file content is read through dock-editor's /desk-editor/fs.read host
 *   route (same-origin fetch, POST { sessionId, path }), exactly like
 *   EditorView
 * - marked (GFM) renders Markdown → HTML; DOMPurify sanitizes it against XSS
 * - relative image srcs and internal file links are resolved through the
 *   host's /dock-markdown/resolve route with a fixed priority: relative to
 *   the Markdown file's directory → the git repo root that contains the file
 *   → the session workspace root. Images are inlined as data URLs; resolved
 *   file links open the target through workbench.openPath on click, and
 *   `#anchor` links scroll to the matching heading.
 * - a document outline (headings h1–h6) is collected while the display HTML
 *   is built; a toolbar toggle reveals a collapsible rail on the left that
 *   scrolls to a heading on click and highlights the heading in view
 *   (scroll-spy).
 * - toolbar (outline toggle, title + "open in editor" switch button) sits
 *   below the floating window title bar; the switch button opens dock-editor's
 *   'editor' view for the same file (floating), implementing the view→edit
 *   conversion
 */
import { createElement, useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { ViewProps, WorkbenchService } from './contract.ts'
import { useLocale, type T } from './hooks'
import { translate } from './i18n'

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

interface ResolveResponse {
  ok: boolean
  value?: {
    found: boolean
    kind?: 'image' | 'link'
    dataUrl?: string
    mime?: string
    size?: number
    tooLarge?: boolean
    path?: string
  }
  error?: { code: string; message: string }
}

/** One relative reference's resolution state, keyed by the ref string. */
type Resolution =
  | { status: 'loading' }
  | { status: 'ok'; kind: 'image'; dataUrl?: string; mime?: string; tooLarge?: boolean; size: number }
  | { status: 'ok'; kind: 'link'; path: string }
  | { status: 'missing' }

/** One document-outline entry (a heading in the rendered document). */
interface OutlineItem {
  id: string
  depth: number
  text: string
}

const INLINE = {
  wrap: { padding: '12px 16px', height: '100%', boxSizing: 'border-box' as const, display: 'flex', flexDirection: 'column' as const },
  head: { display: 'flex', alignItems: 'center', gap: 4, paddingBottom: 8, borderBottom: '1px solid var(--dsw-alias-border-l2, #d8dbe0)', marginBottom: 10, fontSize: 12, color: 'var(--dsw-alias-label-secondary, #656d76)' } as const,
  title: { fontWeight: 600, color: 'var(--dsw-alias-label-primary, #1f2328)', overflow: 'hidden', textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const, marginLeft: 8, flex: 1 },
  toolbarBtn: { border: '1px solid var(--dsw-alias-border-l2, #d8dbe0)', background: 'transparent', color: 'var(--dsw-alias-label-primary, #1f2328)', borderRadius: 5, padding: '2px 9px', cursor: 'pointer', fontSize: 13, lineHeight: 1.45 } as const,
  toolbarBtnOn: { border: '1px solid var(--dsw-alias-interactive-fg-accent, #3b6fe0)', background: 'var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.06))', color: 'var(--dsw-alias-interactive-fg-accent, #3b6fe0)', borderRadius: 5, padding: '2px 9px', cursor: 'pointer', fontSize: 13, lineHeight: 1.45 } as const,
  body: { flex: 1, minHeight: 0, display: 'flex' as const, flexDirection: 'row' as const },
  outline: { width: 200, flexShrink: 0, overflow: 'auto' as const, borderRight: '1px solid var(--dsw-alias-border-l2, #d8dbe0)', padding: '2px 6px 10px', marginRight: 10, boxSizing: 'border-box' as const },
  outlineTitle: { fontSize: 11, color: 'var(--dsw-alias-label-secondary, #656d76)', padding: '4px 6px 6px', fontWeight: 600 } as const,
  outlineItem: { display: 'block', width: '100%', textAlign: 'left' as const, border: 'none', background: 'transparent', color: 'var(--dsw-alias-label-secondary, #656d76)', fontSize: 12, lineHeight: 1.5, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' as const, marginBottom: 1 } as const,
  outlineItemActive: { background: 'var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.06))', color: 'var(--dsw-alias-interactive-fg-accent, #3b6fe0)' } as const,
  outlineEmpty: { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #656d76)', padding: '4px 6px' } as const,
  scroll: { flex: 1, minWidth: 0, overflow: 'auto' as const },
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

/** Image extensions treated as inline images (mirrors the host mime map). */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif'])

/** 1×1 transparent GIF shown while a relative image resolves. */
const PLACEHOLDER_SRC = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

/** True when the ref is a local relative path (not a URL, absolute path,
 *  anchor, or empty). */
function isRelativeRef(ref: string): boolean {
  if (ref === '' || ref.startsWith('#') || ref.startsWith('/') || ref.startsWith('\\')) return false
  if (/^[A-Za-z]:[\\/]/.test(ref)) return false
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(ref)) return false
  return true
}

/** Whether a relative ref points at an image (by extension). */
function refKindOf(ref: string): 'image' | 'link' {
  const at = ref.lastIndexOf('.')
  if (at === -1) return 'link'
  return IMAGE_EXTENSIONS.has(ref.slice(at + 1).toLowerCase()) ? 'image' : 'link'
}

/** Escape `\` and `"` so an id is safe inside an attribute selector. */
function escapeId(id: string): string {
  return id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** GitHub-style slugger: lowercase, strip punctuation, spaces → '-',
 *  dedupe with numeric suffixes. Used for heading ids so `#anchor` links
 *  can scroll (marked v16 no longer emits heading ids). */
function makeSlugger(): (text: string) => string {
  const seen = new Map<string, number>()
  return (text: string): string => {
    const base = text.toLowerCase().trim()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s+/g, '-')
    const slug = base === '' ? 'section' : base
    const count = seen.get(slug) ?? 0
    seen.set(slug, count + 1)
    return count === 0 ? slug : `${slug}-${count}`
  }
}

/** rAF with a setTimeout fallback (jsdom / unusual environments). */
const raf = typeof requestAnimationFrame === 'function'
  ? requestAnimationFrame.bind(globalThis)
  : ((callback: FrameRequestCallback): number => { return setTimeout(() => callback(0), 16) as unknown as number })
const caf = typeof cancelAnimationFrame === 'function'
  ? cancelAnimationFrame.bind(globalThis)
  : ((handle: number): void => { clearTimeout(handle) })

export function MarkdownView(props: ViewProps): ReactNode {
  const { ctx, sessionId, seed } = props
  const openSeed = (seed ?? {}) as OpenSeed
  const path = openSeed.path

  const locale = useLocale(ctx)
  const t: T = useCallback((key: string, params?: Record<string, string | number>): string =>
    translate(locale, key, params), [locale])

  const [content, setContent] = useState<string | null>(null)
  const [binary, setBinary] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [html, setHtml] = useState<string | null>(null)
  /** Sanitized html with resolved srcs / link attributes substituted in. */
  const [displayHtml, setDisplayHtml] = useState<string | null>(null)
  /** ref → resolution state (drives the display rebuild). */
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({})
  /** Document outline (headings h1–h6) of the current document. */
  const [outline, setOutline] = useState<OutlineItem[]>([])
  /** Whether the outline rail is visible. */
  const [outlineOpen, setOutlineOpen] = useState(false)
  /** The heading currently in view (scroll-spy highlight). */
  const [activeHeading, setActiveHeading] = useState<string | null>(null)

  /** Refs already requested from the host for the current document. */
  const requestedRef = useRef<Set<string>>(new Set())
  /** Identity of the document currently being rendered (path + session). */
  const docKeyRef = useRef<string>('')
  /** The html the current outline was collected from (collect once per doc). */
  const outlineHtmlRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

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

  // Resolve relative image/link references through the host and rebuild the
  // display HTML. Runs once per document plus once per resolution arrival.
  useEffect(() => {
    if (html === null || path === undefined) {
      setDisplayHtml(null)
      setOutline([])
      return
    }
    const docKey = `${path}\u0000${sessionId ?? ''}`
    if (docKeyRef.current !== docKey) {
      // A different file: drop the previous document's resolution state.
      docKeyRef.current = docKey
      requestedRef.current.clear()
      setResolutions({})
      setOutline([])
      setActiveHeading(null)
    }

    const doc = new DOMParser().parseFromString(`<div class="dock-md">${html}</div>`, 'text/html')

    // Heading ids so `#anchor` links / outline items can scroll; collect the
    // outline entries once per document (html does not change when image
    // resolutions arrive).
    const slugger = makeSlugger()
    const items: OutlineItem[] = []
    for (const heading of doc.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
      const id = slugger(heading.textContent ?? '')
      heading.id = id
      items.push({ id, depth: Number(heading.tagName.slice(1)), text: (heading.textContent ?? '').trim() })
    }
    if (outlineHtmlRef.current !== html) {
      outlineHtmlRef.current = html
      setOutline(items)
    }

    // Collect the relative references used by images and internal links.
    // A link target like `docs/a.md#section` resolves `docs/a.md` (the
    // fragment only matters inside the target document, which opens at top).
    const refs = new Set<string>()
    for (const img of doc.querySelectorAll('img[src]')) {
      const src = img.getAttribute('src')
      if (src !== null && isRelativeRef(src)) refs.add(src)
    }
    for (const anchor of doc.querySelectorAll('a[href]')) {
      const href = anchor.getAttribute('href')
      if (href !== null && isRelativeRef(href)) {
        const at = href.indexOf('#')
        refs.add(at === -1 ? href : href.slice(0, at))
      }
    }

    // Ask the host to resolve each new reference (first match wins:
    // Markdown dir → git repo root → workspace root).
    for (const ref of refs) {
      if (requestedRef.current.has(ref)) continue
      requestedRef.current.add(ref)
      const kind = refKindOf(ref)
      void (async () => {
        const apply = (resolution: Resolution): void => {
          setResolutions((previous) => ({ ...previous, [ref]: resolution }))
        }
        try {
          const response = await fetch('/dock-markdown/resolve', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId, basePath: path, ref, kind }),
          })
          const json = (await response.json()) as ResolveResponse
          // A stale response for a previously open file must not leak in.
          if (docKeyRef.current !== docKey) return
          if (json.ok !== true || json.value === undefined) {
            throw new Error(json.error?.message ?? 'resolve failed')
          }
          const value = json.value
          if (!value.found) {
            apply({ status: 'missing' })
          } else if (value.kind === 'image' && value.dataUrl !== undefined) {
            apply({ status: 'ok', kind: 'image', dataUrl: value.dataUrl, mime: value.mime ?? '', size: value.size ?? 0 })
          } else if (value.kind === 'image' && value.tooLarge === true) {
            apply({ status: 'ok', kind: 'image', tooLarge: true, size: value.size ?? 0 })
          } else if (value.kind === 'link' && value.path !== undefined) {
            apply({ status: 'ok', kind: 'link', path: value.path })
          } else {
            apply({ status: 'missing' })
          }
        } catch {
          if (docKeyRef.current !== docKey) return
          apply({ status: 'missing' })
        }
      })()
    }

    // Rewrite attributes from the current resolution state, then serialize.
    for (const img of doc.querySelectorAll('img[src]')) {
      const src = img.getAttribute('src')
      if (src === null || !isRelativeRef(src)) continue
      const resolution = resolutions[src]
      if (resolution?.status === 'ok' && resolution.kind === 'image' && resolution.dataUrl !== undefined) {
        img.setAttribute('src', resolution.dataUrl)
      } else {
        img.setAttribute('src', PLACEHOLDER_SRC)
      }
      if (resolution?.status === 'ok' && resolution.kind === 'image' && resolution.tooLarge === true) {
        img.setAttribute('title', `image too large (${resolution.size} bytes, over the 20 MiB limit)`)
      }
    }
    for (const anchor of doc.querySelectorAll('a[href]')) {
      const href = anchor.getAttribute('href')
      if (href === null) continue
      if (href.startsWith('#')) {
        anchor.setAttribute('data-md-anchor', href.slice(1))
        continue
      }
      if (!isRelativeRef(href)) continue
      anchor.setAttribute('data-md-rel', href)
      const at = href.indexOf('#')
      const ref = at === -1 ? href : href.slice(0, at)
      const resolution = resolutions[ref]
      if (resolution?.status === 'ok' && resolution.kind === 'link') {
        anchor.setAttribute('data-md-path', resolution.path)
      }
    }

    setDisplayHtml(doc.body.innerHTML)
  }, [html, resolutions, path, sessionId])

  // Scroll to a heading by id (outline items and `#anchor` links).
  const scrollToHeading = (id: string): void => {
    const heading = scrollRef.current?.querySelector(`[id="${escapeId(id)}"]`)
    if (heading !== undefined && heading !== null && typeof heading.scrollIntoView === 'function') {
      heading.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  // Scroll-spy: highlight the heading currently in view inside the scroll
  // container. Re-attached when the outline or the display HTML changes
  // (image resolutions shift layout).
  useEffect(() => {
    const el = scrollRef.current
    if (el === null || outline.length === 0) return
    let frame = 0
    const update = (): void => {
      frame = 0
      const containerTop = el.getBoundingClientRect().top
      let current: string | null = null
      for (const item of outline) {
        const heading = el.querySelector(`[id="${escapeId(item.id)}"]`)
        if (heading instanceof HTMLElement && heading.getBoundingClientRect().top - containerTop <= 12) {
          current = item.id
        }
      }
      setActiveHeading(current)
    }
    const onScroll = (): void => {
      if (frame !== 0) return
      frame = raf(update)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    update()
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (frame !== 0) caf(frame)
    }
  }, [outline, displayHtml])

  // Toolbar switch: open the same file in dock-editor's 'editor' view
  // (registered id 'editor', the default viewer), floating like this one.
  const switchToEditor = (): void => {
    if (path === undefined) return
    const title = openSeed.title ?? path.split('/').pop() ?? path
    ctx.get<WorkbenchService>('workbench')?.openView('editor', { path, title }, { floating: true })
  }

  const toggleOutline = (): void => {
    setOutlineOpen((open) => !open)
  }

  /** Delegated click handling for the rendered markdown: internal links open
   *  through the workbench instead of navigating the app, `#anchor` links
   *  scroll to the heading, and unresolved relative links never navigate. */
  const onMarkdownClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const anchor = target.closest('a[data-md-anchor]')
    if (anchor instanceof HTMLAnchorElement) {
      event.preventDefault()
      const id = anchor.getAttribute('data-md-anchor')
      if (id !== null && id !== '') scrollToHeading(id)
      return
    }
    const fileLink = target.closest('a[data-md-path]')
    if (fileLink instanceof HTMLAnchorElement) {
      event.preventDefault()
      const targetPath = fileLink.getAttribute('data-md-path')
      if (targetPath !== null) {
        ctx.get<WorkbenchService>('workbench')?.openPath(targetPath)
      }
      return
    }
    if (target.closest('a[data-md-rel]') !== null) {
      event.preventDefault()
    }
  }

  const title = openSeed.title ?? path?.split('/').pop() ?? 'No file'

  return createElement('div', { style: INLINE.wrap },
    // Scoped markdown typography (removed with the component on unmount).
    createElement('style', { dangerouslySetInnerHTML: { __html: MD_CSS } }),
    createElement('div', { style: INLINE.head },
      createElement('button', {
        style: outlineOpen ? INLINE.toolbarBtnOn : INLINE.toolbarBtn,
        title: t('docOutlineTitle'),
        onClick: toggleOutline,
      }, '☰'),
      createElement('button', {
        style: INLINE.toolbarBtn,
        title: t('openInEditor'),
        onClick: switchToEditor,
      }, '✎'),
      createElement('span', { style: INLINE.title, title: path }, title),
      truncated
        ? createElement('span', { style: INLINE.empty }, t('fileTooLarge'))
        : null,
    ),
    error !== null
      ? createElement('div', { style: INLINE.err }, error)
      : content === null
        ? createElement('div', { style: INLINE.empty }, 'Reading…')
        : binary
          ? createElement('div', { style: INLINE.err }, 'Binary file — markdown preview is not supported.')
          : createElement('div', { style: INLINE.body },
            outlineOpen
              ? createElement('div', { style: INLINE.outline },
                createElement('div', { style: INLINE.outlineTitle }, t('outline')),
                outline.length === 0
                  ? createElement('div', { style: INLINE.outlineEmpty }, t('noHeadingStructure'))
                  : outline.map((item) => createElement('button', {
                    key: item.id,
                    style: {
                      ...INLINE.outlineItem,
                      paddingLeft: 8 + (item.depth - 1) * 12,
                      fontWeight: item.depth <= 2 ? 600 : 400,
                      ...(item.id === activeHeading ? INLINE.outlineItemActive : {}),
                    },
                    title: item.text,
                    onClick: () => scrollToHeading(item.id),
                  }, item.text === '' ? t('untitled') : item.text)),
              )
              : null,
            createElement('div', { style: INLINE.scroll, ref: scrollRef, onClick: onMarkdownClick },
              createElement('div', {
                dangerouslySetInnerHTML: { __html: displayHtml ?? '' },
              }),
            ),
          ),
  )
}
