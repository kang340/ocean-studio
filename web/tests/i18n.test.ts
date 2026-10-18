import assert from 'node:assert/strict';
import english from '../src/i18n/en.json';
import { normalizeLanguage, resolveLanguage, translateFor, languageUrl } from '../src/i18n';
import { displayText, localizeDisplayData } from '../src/i18n/display';

assert.equal(normalizeLanguage('en-US'), 'en');
assert.equal(normalizeLanguage('zh-CN'), 'zh');
assert.equal(normalizeLanguage('fr'), null);
assert.equal(resolveLanguage('?lang=en', 'zh'), 'en');
assert.equal(resolveLanguage('?mode=model', 'en'), 'en');
assert.equal(resolveLanguage('?lang=invalid'), 'zh');
assert.equal(translateFor('en', '导出 CSV'), 'Export CSV');
assert.equal(translateFor('zh', '{0} 平台', 123), '123 平台');
assert.equal(translateFor('en', '{0} 平台', 123), '123 platforms');
assert.equal(translateFor('en', 'unmapped/file-id'), 'unmapped/file-id');
const url = new URL(languageUrl('https://example.test/ocean-studio.html?mode=model&el=wind&cmp=era5&z=5#map', 'en'), 'https://example.test');
assert.equal(url.searchParams.get('el'), 'wind'); assert.equal(url.searchParams.get('cmp'), 'era5'); assert.equal(url.searchParams.get('z'), '5'); assert.equal(url.hash, '#map'); assert.equal(url.searchParams.get('lang'), 'en');
for (const [key, value] of Object.entries(english)) {
  const slots = (s: string) => [...s.matchAll(/\{(\d+)\}/g)].map(m => m[1]).sort();
  assert.deepEqual(slots(value), slots(key), 'Template slots: ' + key);
}
assert.equal(displayText('最近模式时刻，|Δt| ≤ 3 h', 'en'), 'Nearest model time, |Δt| ≤ 3 h');
assert.equal(displayText('最近模式时刻，|Δt| ≤ 3 h；相邻两时刻均有效时线性插值', 'en'), 'Nearest model time, |Δt| ≤ 3 h; linear interpolation when both adjacent times are valid');
assert.match(displayText('4 个同网格、同预报时效的已下载文件按有效时间组成序列', 'en'), /^4 downloaded files/);
const raw = { id: '海温', dataset: '原始名称', name: '风速', path: '数据/海温.nc', label: '海温', values: [1, null, 3], qc: ['good', 'bad'], notes: ['单一时刻'], method: { space: '最近模式深度层' }, qc_codes: { '1': { class: 'good', text: '良好' } } };
const localized = localizeDisplayData(raw, 'en');
assert.equal(localized.label, 'Sea temperature'); assert.equal(localized.id, raw.id); assert.equal(localized.dataset, raw.dataset); assert.equal(localized.name, raw.name); assert.equal(localized.path, raw.path); assert.equal(localized.values, raw.values); assert.equal(localized.qc, raw.qc); assert.equal(localized.notes[0], 'Single timestamp'); assert.equal(localized.qc_codes['1'].class, 'good'); assert.equal(localized.qc_codes['1'].text, 'Good');
assert.equal(raw.label, '海温'); assert.equal(localizeDisplayData(raw, 'zh'), raw);
console.log('i18n: locale, templates, shared scenes and raw-data preservation passed');
