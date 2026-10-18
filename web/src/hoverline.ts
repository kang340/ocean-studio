// Structured hover read-outs. Units, long names and observation ids come from data files and must only ever be
// shown as text, so read-outs are built as small element trees and rendered with createElement / textContent.
export type HNode = { tag: "span" | "em" | "b" | "i"; cls?: string; kids: (HNode | string)[] };

export const h = (tag: HNode["tag"], cls: string | undefined, ...kids: (HNode | string | number | null | undefined | false)[]): HNode =>
  ({ tag, cls, kids: kids.filter((k): k is HNode | string | number => k !== null && k !== undefined && k !== false).map(k => (typeof k === "number" ? String(k) : k)) });

/** Minimal DOM surface used by renderHover (lets tests run in node without a DOM). */
export type MiniDoc = { createElement(tag: string): any; createTextNode(text: string): any };

export function toDom(n: HNode, doc: MiniDoc): any {
  const el = doc.createElement(n.tag); if (n.cls) el.className = n.cls;
  for (const k of n.kids) el.append(typeof k === "string" ? doc.createTextNode(k) : toDom(k, doc));
  return el;
}

/** Replace the children of `el` with the given nodes. */
export function renderHover(el: { replaceChildren(...nodes: any[]): void }, nodes: HNode[], doc: MiniDoc = document) {
  el.replaceChildren(...nodes.map(n => toDom(n, doc)));
}

/** Plain text of a node tree (for tests and accessibility labels). */
export const textOf = (n: HNode | string): string => (typeof n === "string" ? n : n.kids.map(textOf).join(""));
