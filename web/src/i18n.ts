import english from './i18n/en.json';

export type Language = 'zh' | 'en';
const STORAGE_KEY = 'ocean-studio-language';
export function normalizeLanguage(value: string | null | undefined): Language | null {
  return /^en(?:[-_]|$)/i.test(value || '') ? 'en' : /^zh(?:[-_]|$)/i.test(value || '') ? 'zh' : null;
}
export function resolveLanguage(search: string, saved?: string | null): Language {
  return normalizeLanguage(new URLSearchParams(search).get('lang')) || normalizeLanguage(saved) || 'zh';
}
function initialLanguage(): Language {
  if (typeof window === 'undefined') return 'zh';
  let saved: string | null = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch { /* storage may be disabled */ }
  return resolveLanguage(location.search, saved);
}
export const language = initialLanguage();
export function translateFor(lang: Language, key: string, ...values: unknown[]): string {
  const template = lang === 'en' ? (english as Record<string, string>)[key] ?? key : key;
  return template.replace(/{(\d+)}/g, (token, index: string) => Number(index) < values.length ? String(values[Number(index)]) : token);
}
export const t = (key: string, ...values: unknown[]) => translateFor(language, key, ...values);
export function languageUrl(url: string, lang: Language): string {
  const next = new URL(url, 'https://ocean-studio.invalid');
  next.searchParams.set('lang', lang);
  return next.pathname + next.search + next.hash;
}
export function switchLanguage(lang: Language) {
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* URL remains usable */ }
  // Reload to rebuild canvas charts, map labels and module-level labels together.
  location.assign(languageUrl(location.href, lang));
}
if (typeof document !== 'undefined') {
  document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
  document.title = language === 'en' ? 'Ocean Studio · Ocean & Atmosphere Workbench' : 'Ocean Studio · 全球海洋气象数据工作台';
  try { localStorage.setItem(STORAGE_KEY, language); } catch { /* optional preference */ }
}
