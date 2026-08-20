/**
 * Client half of dock-markdown: registers the 'markdown' file viewer
 * (md / markdown / mdx) against the dock-files file domain and the matching
 * editor-area view against dock. The view renders a file's Markdown content
 * (marked + DOMPurify) and offers a toolbar switch that opens the same file
 * in dock-editor's 'editor' view for editing.
 *
 * inject declares BOTH 'workbench' and 'files': Cordis activates this plugin
 * only after dock (carrier) and dock-files (file domain) have provided their
 * services, so the viewer registration is never skipped by activation order.
 */
import type { WorkbenchContext, WorkbenchService } from './contract.ts'
import { MarkdownView } from './MarkdownView'

/** Requires the workbench base (carrier) and the dock-files file domain. */
export const inject = ['workbench', 'files']

/** Local structural face of ctx.files (avoid type dependency on dock-files). */
interface FilesService {
  registerFileViewer(def: {
    id: string
    exts?: string[]
    default?: boolean
    icon?: { color?: string; path?: string; viewBox?: string }
  }): () => void
}

/** Client plugin body. */
export function apply(ctx: WorkbenchContext): void {
  const workbench = ctx.get<WorkbenchService>('workbench')
  const files = ctx.get<FilesService>('files')
  // inject guarantees both services are present when this applies; guard
  // anyway so a broken runtime degrades instead of throwing.
  if (workbench === undefined || files === undefined) return

  // Register the markdown viewer for .md / .markdown / .mdx files (the
  // catch-all default stays dock-editor's 'editor' viewer), with the
  // explorer icon for those types: a markdown-logo glyph (rounded frame +
  // thick M with the V dipping down + down arrow, single evenodd path in a
  // 16×16 viewBox) tinted blue.
  ctx.effect(() => files.registerFileViewer({
    id: 'markdown',
    exts: ['md', 'markdown', 'mdx'],
    icon: {
      color: '#4aa3df',
      viewBox: '0 0 16 16',
      path: 'M5.40 2.20h5.20a3.2 3.2 0 0 1 3.2 3.2v5.20a3.2 3.2 0 0 1 -3.2 3.2h-5.20a3.2 3.2 0 0 1 -3.2 -3.2v-5.20a3.2 3.2 0 0 1 3.2 -3.2zM5.80 3.80h4.40a2 2 0 0 1 2 2v4.40a2 2 0 0 1 -2 2h-4.40a2 2 0 0 1 -2 -2v-4.40a2 2 0 0 1 2 -2zM5.45 6.40L5.45 9.60L6.75 9.60L6.75 6.40ZM5.60 6.82L8.30 10.02L9.30 9.18L6.60 5.98ZM9.30 10.02L12.00 6.82L11.00 5.98L8.30 9.18ZM10.85 6.40L10.85 9.60L12.15 9.60L12.15 6.40ZM8.15 10.30L8.15 11.50L9.45 11.50L9.45 10.30ZM9.27 11.05L8.37 10.10L7.43 11.00L8.33 11.95ZM9.27 11.95L10.17 11.00L9.23 10.10L8.33 11.05Z',
    },
  }), 'dock-markdown: file viewer')

  // The view that receives open seeds ({ path, title }). Like dock-editor it
  // stays registered as an editor-area view; floating windows resolve their
  // view through this registry, and dock-files dispatches { mode: 'floating' }.
  ctx.effect(() => workbench.registerEditorView({
    id: 'markdown',
    title: 'Markdown',
    order: 110,
    component: MarkdownView,
  }), 'dock-markdown: view')
}
