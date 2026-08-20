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
  registerFileViewer(def: { id: string; exts?: string[]; default?: boolean }): () => void
}

/** Client plugin body. */
export function apply(ctx: WorkbenchContext): void {
  const workbench = ctx.get<WorkbenchService>('workbench')
  const files = ctx.get<FilesService>('files')
  // inject guarantees both services are present when this applies; guard
  // anyway so a broken runtime degrades instead of throwing.
  if (workbench === undefined || files === undefined) return

  // Register the markdown viewer for .md / .markdown / .mdx files (the
  // catch-all default stays dock-editor's 'editor' viewer).
  ctx.effect(() => files.registerFileViewer({ id: 'markdown', exts: ['md', 'markdown', 'mdx'] }), 'dock-markdown: file viewer')

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
