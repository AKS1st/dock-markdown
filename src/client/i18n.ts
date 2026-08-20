/**
 * dock-markdown client i18n: a tiny, dependency-free dictionary module (zh / en)
 * plus a `detectLocale` helper that reads the DSH locale service
 * (`ctx.get('locale').getSnapshot().active`, backed by settings.yaml
 * locale.preference with the browser language as fallback).
 *
 * The module is deliberately pure — no runtime imports, no DOM, no React — so
 * it can run standalone under `node --experimental-strip-types`. The view
 * layer combines it with the DSH `locale/change` event (ctx.on) to re-render
 * on a system locale switch.
 *
 * Lookup order per key: DICTS[locale][key] → DICTS.zh[key] → the key itself
 * (missing text stays visible rather than blank).
 */

export type LocaleId = 'zh' | 'en'

export interface Dict {
  [key: string]: string
}

/** Complete dictionaries — every key below exists in BOTH locales. */
export const DICTS: Record<LocaleId, Dict> = {
  zh: {
    // ── Toolbar ──────────────────────────────────────────────────────────
    docOutlineTitle: '文档大纲',
    openInEditor: '用编辑器打开',
    fileTooLarge: '（文件过大，仅显示前 256 KiB）',

    // ── Document outline rail ────────────────────────────────────────────
    outline: '大纲',
    noHeadingStructure: '（无标题结构）',
    untitled: '（无标题）',
  },
  en: {
    // ── Toolbar ──────────────────────────────────────────────────────────
    docOutlineTitle: 'Outline',
    openInEditor: 'Open in Editor',
    fileTooLarge: 'File too large, showing the first 256 KiB only',

    // ── Document outline rail ────────────────────────────────────────────
    outline: 'Outline',
    noHeadingStructure: 'No heading structure',
    untitled: 'Untitled',
  },
}

/**
 * Look up a dictionary key for a locale. Missing key → zh fallback → the key
 * itself (never blank). `{name}` placeholders are replaced from `params`.
 */
export function translate(locale: LocaleId, key: string, params?: Record<string, string | number>): string {
  const template = DICTS[locale]?.[key] ?? DICTS.zh[key] ?? key
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    (name in params ? String(params[name]) : match))
}

/**
 * Resolve the active locale: the DSH locale service
 * (`ctx.get('locale')?.getSnapshot?.()?.active`, 'zh' | 'en') wins; otherwise
 * the browser language (`navigator.language.startsWith('zh')`) decides, with
 * English as the last resort. `ctx` may be absent (standalone runs).
 */
export function detectLocale(ctx: unknown): LocaleId {
  const locale = (ctx as { get?: (name: string) => unknown } | null | undefined)?.get?.('locale') as
    | { getSnapshot?: () => { active?: unknown } }
    | undefined
  const active = locale?.getSnapshot?.()?.active
  if (active === 'zh' || active === 'en') return active
  if (typeof navigator !== 'undefined' && typeof navigator.language === 'string' && navigator.language.toLowerCase().startsWith('zh')) {
    return 'zh'
  }
  return 'en'
}
