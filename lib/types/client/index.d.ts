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
import type { WorkbenchContext } from './contract.ts';
/** Requires the workbench base (carrier) and the dock-files file domain. */
export declare const inject: string[];
/** Client plugin body. */
export declare function apply(ctx: WorkbenchContext): void;
