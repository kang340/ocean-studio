// Loaded slices live in a ref and are replaced asynchronously, while the selected element / variable / vector
// changes synchronously on click. Before a slice is drawn, sampled or rasterised it must be checked against the
// current selection: a slice of the previous element can lack the arrays the new selection indexes.
import type { Field } from "../viz/data";

/** True when `f` carries every variable in `vars` (in any order). */
export function hasVars(f: Field | null | undefined, vars: readonly (string | null | undefined)[] | null | undefined): f is Field {
  if (!f || !vars || !vars.length) return false;
  const names = f.variables.map(v => v.name);
  return vars.every(n => !!n && names.includes(n)) && f.arrays.length >= vars.length;
}

/** Scalar rasterisation reads arrays 0 (and 1 for |u,v|) directly, so the variables must lead in order. */
export function scalarReady(f: Field | null | undefined, vars: readonly string[] | null | undefined): f is Field {
  return hasVars(f, vars) && vars!.every((n, i) => f.variables[i]?.name === n);
}

export type SliceSet = { s?: Field | null; sd?: Field | null; v?: Field | null; s2?: Field | null; v2?: Field | null; w?: number | null; wave?: Field | null };

/** The loaded slices that belong to the current selection; others are dropped until the new request lands. */
export function freshFields<T extends SliceSet>(raw: T, scalarVars: readonly string[] | null, vectorVars: readonly string[] | null, waveVars: readonly string[] | null): T {
  const s = (f?: Field | null) => (scalarVars && scalarReady(f, scalarVars) ? f : null);
  const v = (f?: Field | null) => (vectorVars && hasVars(f, vectorVars) ? f : null);
  return { ...raw, s: s(raw.s), sd: s(raw.sd), s2: s(raw.s2), v: v(raw.v), v2: v(raw.v2), wave: waveVars && hasVars(raw.wave, waveVars) ? raw.wave : null };
}

/** Index of each variable in the slice, or null when one is missing. */
export function varIndex(f: Field | null | undefined, vars: readonly string[]): number[] | null {
  if (!hasVars(f, vars)) return null;
  const names = f.variables.map(v => v.name);
  return vars.map(n => names.indexOf(n));
}
