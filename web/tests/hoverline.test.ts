// Audit #3: file metadata (units, long_name) and observation ids must render as text, never as markup.
import assert from "node:assert/strict";
import { h, renderHover, toDom, textOf, type MiniDoc } from "../src/hoverline";

// Fake DOM: records every element creation; text nodes are opaque strings, so markup in them cannot become elements.
type FakeEl = { tag: string; className?: string; children: (FakeEl | { text: string })[]; append(...n: any[]): void; replaceChildren(...n: any[]): void };
const created: string[] = [];
const doc: MiniDoc = {
  createElement(tag: string): FakeEl { created.push(tag); const el: FakeEl = { tag, children: [], append(...n) { el.children.push(...n); }, replaceChildren(...n) { el.children = n; } }; return el; },
  createTextNode(text: string) { return { text }; },
};
const allTags = (n: any): string[] => (n.tag ? [n.tag, ...n.children.flatMap(allTags)] : []);
const allText = (n: any): string => (n.tag ? n.children.map(allText).join("") : n.text);

const UNIT = "<img src=x onerror=alert(1)>", PID = '"<script>alert(document.cookie)</script>';

// 1. the old string concatenation really produced markup (what innerHTML would have parsed)
{ const old = `<em><b>${(21.5).toFixed(1)}</b> ${UNIT}</em>`; assert.ok(/<img[^>]*onerror/.test(old), "pre-fix read-out contains an element"); }

// 2. malicious unit: only the expected elements are created; the payload is plain text
{ created.length = 0; const host = doc.createElement("div") as FakeEl; created.length = 0;
  renderHover(host, [h("span", undefined, "22.00°N 125.00°E"), h("em", undefined, h("b", undefined, "21.5"), ` ${UNIT}`)], doc);
  assert.deepEqual(created, ["span", "em", "b"]);
  assert.deepEqual(host.children.flatMap(allTags), ["span", "em", "b"]);
  assert.equal(allText(host.children[1]), `21.5 ${UNIT}`); }

// 3. malicious platform id in an observation read-out (class kept, no script element)
{ created.length = 0; const node = toDom(h("em", "obs", `Argo ${PID} · 21.30 · 10-15 06:00`), doc) as FakeEl;
  assert.deepEqual(created, ["em"]); assert.equal(node.className, "obs"); assert.ok(allText(node).includes("<script>")); }

// 4. comparison read-out keeps the original structure and classes (i.ab / i.ab.b / b) for the CSS
{ created.length = 0; const n = h("em", undefined, h("i", "ab", "A"), h("b", undefined, "21.5"), " ", h("i", "ab b", "B"), h("b", undefined, "21.1"), ` °C · Δ 0.4`);
  const el = toDom(n, doc) as FakeEl; assert.deepEqual(allTags(el), ["em", "i", "b", "i", "b"]);
  assert.deepEqual(el.children.filter((c: any) => c.tag === "i").map((c: any) => c.className), ["ab", "ab b"]);
  assert.equal(textOf(n), "A21.5 B21.1 °C · Δ 0.4"); }

// 5. builder drops empty kids, stringifies numbers
{ const n = h("em", "muted", null, undefined, false, 3, "无数据"); assert.deepEqual(n.kids, ["3", "无数据"]); }
console.log("hoverline: ok");
