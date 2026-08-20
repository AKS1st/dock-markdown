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
import { type ReactNode } from 'react';
import type { ViewProps } from './contract.ts';
export declare function MarkdownView(props: ViewProps): ReactNode;
