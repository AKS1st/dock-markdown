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
export type LocaleId = 'zh' | 'en';
export interface Dict {
    [key: string]: string;
}
/** Complete dictionaries — every key below exists in BOTH locales. */
export declare const DICTS: Record<LocaleId, Dict>;
/**
 * Look up a dictionary key for a locale. Missing key → zh fallback → the key
 * itself (never blank). `{name}` placeholders are replaced from `params`.
 */
export declare function translate(locale: LocaleId, key: string, params?: Record<string, string | number>): string;
/**
 * Resolve the active locale: the DSH locale service
 * (`ctx.get('locale')?.getSnapshot?.()?.active`, 'zh' | 'en') wins; otherwise
 * the browser language (`navigator.language.startsWith('zh')`) decides, with
 * English as the last resort. `ctx` may be absent (standalone runs).
 */
export declare function detectLocale(ctx: unknown): LocaleId;
