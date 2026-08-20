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
import { type ReactNode } from 'react';
import type { ViewProps } from './contract.ts';
export declare function MarkdownView(props: ViewProps): ReactNode;
