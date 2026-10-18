import english from './en.json';
import { language, translateFor, type Language } from '../i18n';

const entries = Object.entries(english).sort((a, b) => b[0].length - a[0].length);
const escape = (text: string) => Array.from(text, char => '.*+?^${}()|[]'.includes(char) || char.charCodeAt(0) === 92 ? String.fromCharCode(92) + char : char).join('');
// Full-message patterns preserve numeric values, source IDs and timestamps.
const patterns = entries.filter(([key]) => /\{\d+\}/.test(key)).map(([key]) => {
  const slots: number[] = [];
  const parts = key.split(/(\{\d+\})/g).map(part => {
    if (/^\{\d+\}$/.test(part)) { slots.push(Number(part.slice(1, -1))); return '(.*?)'; }
    return escape(part);
  });
  return { key, slots, regex: new RegExp('^' + parts.join('') + '$') };
});
const fragments = entries.filter(([key]) => key.length >= 4 && !/\{\d+\}/.test(key));
export function displayText(text: string, lang: Language = language): string {
  if (lang !== 'en' || !/[\u3400-\u9fff]/.test(text)) return text;
  if (Object.hasOwn(english, text)) return translateFor(lang, text);
  for (const { key, slots, regex } of patterns) {
    const match = regex.exec(text);
    if (match) { const values: string[] = []; slots.forEach((slot, i) => values[slot] = displayText(match[i + 1], lang)); return translateFor(lang, key, ...values); }
  }
  const clauses = text.split(/(?=；)/);
  if (clauses.length > 1) return clauses.map(part => displayText(part, lang)).join('');
  // Some API notes join complete sentences or prefix an external error.
  let result = text;
  for (const [key, value] of fragments) if (result.includes(key)) result = result.split(key).join(value);
  return result;
}
const fields = new Set(['label', 'obs_label', 'provider_label', 'type_label', 'platform_label', 'family', 'title', 'reason', 'note', 'notes', 'qc_scheme', 'outlier_rule', 'selection']);
const groups = new Set(['method', 'qc_classes', 'qc_codes', 'cline']);
/** Translate display metadata only. Never alter raw data, identifiers or machine codes. */
export function localizeDisplayData<T>(value: T, lang: Language = language): T {
  if (lang !== 'en') return value;
  function visit(v: unknown, display = false): unknown {
    if (typeof v === 'string') return display ? displayText(v, lang) : v;
    if (Array.isArray(v)) return !display && v.every(item => item === null || typeof item !== 'object') ? v : v.map(item => visit(item, display));
    if (!v || typeof v !== 'object' || ArrayBuffer.isView(v)) return v;
    return Object.fromEntries(Object.entries(v).map(([key, item]) => [key, visit(item, display || fields.has(key) || groups.has(key))]));
  }
  return visit(value) as T;
}
