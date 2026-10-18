import { t as i18nText } from "../i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Globe2, Map as MapIcon, Sun, Moon, Maximize2, Presentation, BoxSelect, Crosshair, Spline, Info, Layers as LayersIcon, PanelLeftClose, PanelLeftOpen, Satellite, Grid3x3, Github, Languages } from "lucide-react";
import { language, switchLanguage } from "../i18n";
import "../theme.css"; import "./studio.css"; import "./elements.css";
import { useTheme } from "../shell";
import * as A from "./api";
import { StudioMap } from "./map/StudioMap";
import { ObsLayer, TYPE_STYLE } from "./map/ObsLayer";
import { FieldLayer } from "./engine/FieldLayer";
import { ParticleLayer } from "./engine/ParticleLayer";
import { FlowLayer, vectorField, type FlowField } from "../viz/flow";
import { displayArray, isolines, robustRange } from "../viz/render";
import { lut, specFor, gradientCss, PALETTES, bearing, compass } from "../viz/palettes";
import * as M from "../viz/model";
import { Timeline, fmtTime, type Lane } from "./ui/Timeline";
import { ModelPanel, ObsPanel, FusionPanel, layeredGrids, type FieldUi, type FlowUi, type ObsUi, type FusionUi, type ProfileUi } from "./ui/Panels";
import { ELEMENTS, elementById, sourcesFor, pickFile, vectorFor, compareBlockers, boxesOverlap, elementOf, type ElementId } from "./elements";
import { common, diffStats, clipLinesLon } from "./compare";
import { ElementBar, SourceSwitcher, ElementPanel, CompareInspector, SideMap, NoLocalData, SwipeHandle, CMP_A, CMP_B, type CompareUi, type CmpStatus, type SideApi } from "./ui/Elements";
import { matchProfiles, type ObsProfile, type ModelColumn } from "./profmatch";
import { ProfileMatchInspector, type ProfileRun } from "./ui/ProfileMatch";
import { canonUnit } from "../viz/palettes";
import { PlatformInspector, MatchInspector, PointInspector, RegionInspector, type ModelCtx } from "./ui/Inspectors";
import { fmtN } from "./charts/theme";
import { freshFields } from "./fieldfresh";
import { h, renderHover, type HNode } from "../hoverline";
import { sectionQuery } from "./section";
import { SectionInspector } from "./ui/Section";
import { AboutDialog } from "./ui/About";
import { Component, type ReactNode } from "react";

type Mode = "model" | "obs" | "fusion";
type Insp = null | { kind: "platform"; ds: string; pid: string } | { kind: "match" } | { kind: "point"; data: any } | { kind: "region"; data: any } | { kind: "compare"; data: any } | { kind: "section"; data: any } | { kind: "profiles" };
const Q = new URLSearchParams(location.search);
const OCEAN = new Set(["sea_temperature", "salinity", "ssh", "current_speed", "current_u", "current_v", "wave_height", "wave_period", "wave_direction", "sea_ice", "chlorophyll", "mixed_layer", "ice_speed"]);
const PROVIDER_RANK: Record<string, number> = { gfs: 0, hycom: 1, copernicus: 2, wavewatch: 3, era5: 4 };
const OBS_COLORS = ["#4cc3ef", "#f5b942", "#7ee0a8", "#e78ac3", "#9b8cf0", "#ff8f6b"];
const BASE_CELLS = 1_000_000, DETAIL_CELLS = 650_000;
const DEBUG = Q.has("debug");
type Fields = { s?: A.Field | null; sd?: A.Field | null; v?: A.Field | null; s2?: A.Field | null; v2?: A.Field | null; w?: number | null; wave?: A.Field | null };

function StudioApp() {
  const [theme, toggleTheme] = useTheme();
  const [mode, setMode] = useState<Mode>((Q.get("mode") as Mode) || "model");
  const [datasets, setDatasets] = useState<A.VizDataset[]>([]), [catalogErr, setCatalogErr] = useState("");
  // ---- model
  const [modelId, setModelId] = useState<string | null>(Q.get("model") || Q.get("dataset"));
  const [model, setModel] = useState<A.VizDataset | null>(null);
  const [scalarId, setScalarId] = useState<string | null>(Q.get("var")), [vectorId, setVectorId] = useState<string | null>(Q.get("vec"));
  const [flowSource, setFlowSource] = useState<string | null>(null), [flowDs, setFlowDs] = useState<A.VizDataset | null>(null);
  const [frameSet, setFrameSet] = useState<A.FrameSet | null>(null), frameOwner = useRef<string | null>(null);
  const [depth, setDepth] = useState<number | null>(Q.get("z") ? Number(Q.get("z")) : null);
  const [fieldUi, setFieldUi] = useState<FieldUi>({ palette: "", opacity: 0.92, bands: 0, contours: false, contourStep: 0 });
  const [flowUi, setFlowUi] = useState<FlowUi>({ particles: true, arrows: false, density: 1, speed: 1, trail: 22, width: 1.25, bright: 1, color: "white" });
  const [waves, setWaves] = useState(false), [range, setRange] = useState<[number, number] | null>(null);
  // ---- time
  const [cursor, setCursor] = useState<number>(A.tms(Q.get("t")));
  const [playing, setPlaying] = useState(false), [step, setStep] = useState<"model" | number>("model"), [fps, setFps] = useState(1);
  const [windowH, setWindowH] = useState(6), [interp, setInterp] = useState(false), [tz, setTz] = useState<"utc" | "local">("utc");
  // ---- observations
  const [obsSel, setObsSel] = useState<string[]>(Q.get("obs") ? Q.get("obs")!.split(",") : []);
  const [summaries, setSummaries] = useState<Record<string, A.ObsSummary>>({}), [features, setFeatures] = useState<Record<string, A.ObsFeatures>>({});
  const [obsUi, setObsUi] = useState<ObsUi>({ variable: {}, qc: "default", tracks: true, density: false, types: [], unify: true, depthMax: null });
  // ---- fusion
  const [fusion, setFusion] = useState<FusionUi>({ model: null, obs: null, obsVar: null, maxDt: 3, interp: true, qc: "default", depthMax: 30, useView: false });
  const [match, setMatch] = useState<A.MatchResult | null>(null), [matchBusy, setMatchBusy] = useState(false), [suggestions, setSuggestions] = useState<A.Suggestion[] | null>(null);
  const [prof, setProf] = useState<ProfileUi>({ modelT: null, modelS: null, maxDt: 12, maxDepth: 2000, adjusted: true }), [profRun, setProfRun] = useState<ProfileRun | null>(null), [profBusy, setProfBusy] = useState(false);
  // ---- element browsing (element → source → file) and source comparison
  const [browse, setBrowse] = useState<"element" | "file">(Q.get("browse") === "file" || ((Q.get("model") || Q.get("dataset")) && !Q.get("el")) ? "file" : "element");
  const [elementId, setElementId] = useState<ElementId | null>((Q.get("el") as ElementId) || null), [srcProvider, setSrcProvider] = useState<string | null>(Q.get("src"));
  const [cmp, setCmp] = useState<CompareUi>({ on: Q.get("cmp") != null, provider: Q.get("cmp") || null, view: (Q.get("cv") as CompareUi["view"]) || "swipe", opacity: 0.6, swipe: 0.5, maxDt: 3 });
  // ---- view & chrome
  const [globe, setGlobe] = useState(Q.get("view") === "globe"), [basemap, setBasemap] = useState<"vector" | "satellite">("vector");
  const [insp, setInsp] = useState<Insp>(null), [basket, setBasket] = useState<{ ds: string; pid: string }[]>([]);
  const [tool, setTool] = useState<"inspect" | "region" | "section">("inspect"), [secPts, setSecPts] = useState<[number, number][]>([]), [present, setPresent] = useState(false), [leftOpen, setLeftOpen] = useState(true), [about, setAbout] = useState(() => !location.search && !localStorage.getItem("ocean-studio-welcomed"));
  const [loading, setLoading] = useState(0), [error, setError] = useState(""), [fieldsVersion, setFieldsVersion] = useState(0), [viewTick, setViewTick] = useState(0), [mapReady, setMapReady] = useState(false);
  const [track, setTrack] = useState<A.Platform["track"] | null>(null);
  const mapEl = useRef<HTMLDivElement>(null), hoverEl = useRef<HTMLDivElement>(null);
  const fieldB = useRef<FieldLayer | null>(null), sideApi = useRef<SideApi | null>(null), crossEl = useRef<HTMLDivElement>(null), lastDepth = useRef<number | null>(Q.get("z") ? Number(Q.get("z")) : null), userDepth = useRef<number | null>(Q.get("z") ? Number(Q.get("z")) : null);
  const sm = useRef<StudioMap | null>(null), fieldL = useRef<FieldLayer | null>(null), partL = useRef<ParticleLayer | null>(null), waveL = useRef<ParticleLayer | null>(null), arrows = useRef<FlowLayer | null>(null);
  const partB = useRef<ParticleLayer | null>(null), arrowsB = useRef<FlowLayer | null>(null), contourAll = useRef<{ lines: GeoJSON.FeatureCollection; unit: string } | null>(null), swipeRef = useRef<{ x: number } | null>(null);
  const obsL = useRef(new Map<string, ObsLayer>()), F = useRef<Fields>({}), reqRef = useRef(0), rangeKey = useRef(""), live = useRef<any>({});
  const busy = (d: number) => setLoading(n => Math.max(0, n + d));

  // ---------------------------------------------------------------- catalogue
  const refresh = useCallback(() => A.listDatasets().then(list => { setDatasets(list); setCatalogErr(""); return list; }).catch(e => { setCatalogErr(e.message); return [] as A.VizDataset[]; }), []);
  useEffect(() => {
    refresh().then(list => {
      const grids = list.filter(d => d.kind === "grid" && d.renderable);
      if (!modelId && grids.length && browse === "file") {
        const latest = (d: A.VizDataset) => A.tms(d.summary?.times?.[d.summary.times.length - 1]) || 0;
        const pick = grids.slice().sort((a, b) => latest(b) - latest(a) || (PROVIDER_RANK[a.provider] ?? 9) - (PROVIDER_RANK[b.provider] ?? 9))[0];
        setModelId(pick.id);
      }
      if (!obsSel.length) { const o = list.filter(d => d.kind === "observations" && d.renderable).sort((a, b) => (b.observations?.records || 0) - (a.observations?.records || 0))[0]; if (o && (mode !== "model")) setObsSel([o.id]); }
    });
    A.suggest().then(setSuggestions).catch(() => setSuggestions([]));
  }, []);
  useEffect(() => {
    if (!modelId) return; let stale = false; busy(1);
    A.getDataset(modelId).then(d => {
      if (stale) return; setModel(d); const desc = d.describe; if (!desc) return;
      const opts = M.scalarOptions(desc);
      setScalarId(id => (id === "none" || opts.some(o => o.id === id) ? id : M.defaultScalar(opts)));
      if (!flowSource) setVectorId(id => (id === "none" || desc.vectors.some(v => v.id === id && v.u) ? id : desc.vectors.find(v => v.u)?.id ?? null));
      // keep the chosen depth across sources: snap to the nearest level of the new file (levels differ between models)
      const z = Object.values(desc.depths)[0]; setDepth(v => { const want = userDepth.current ?? v ?? lastDepth.current; if (!z) return null; if (want == null) return z.values[0];
        return z.values.reduce((b, x) => (Math.abs(x - want) < Math.abs(b - want) ? x : b), z.values[0]); });
      if (!fusion.model) setFusion(f => ({ ...f, model: d.id }));
    }).catch(e => !stale && setError(e.message)).finally(() => busy(-1));
    return () => { stale = true; };
  }, [modelId]);
  useEffect(() => { if (!flowSource || flowSource === modelId) { setFlowDs(null); return; } A.getDataset(flowSource).then(d => { setFlowDs(d); setVectorId(d.describe?.vectors.find(v => v.u)?.id ?? null); }).catch(e => setError(e.message)); }, [flowSource, modelId]);
  const desc = model?.describe || null, scalars = useMemo(() => (desc ? M.scalarOptions(desc) : []), [desc]);
  const scalar = scalars.find(s => s.id === scalarId) || null, vecDs = flowSource && flowSource !== modelId ? flowDs : model;
  const vector = vecDs?.describe?.vectors.find(v => v.id === vectorId && v.u) || null;
  const waveVec = desc?.vectors.find(v => v.kind === "wave") || null;
  const timeVar = scalar?.vars[0] || vector?.u || scalars[0]?.vars[0];
  const depthAxis = desc && scalar ? M.depthsFor(desc, scalar.axis) : null;
  const ocean = scalar ? OCEAN.has(scalar.kind) || (scalar.kind === "generic" && ["hycom", "copernicus", "wavewatch"].includes(model?.provider || "")) : true;
  const flowKind = vector ? M.flowKind(vector) : "";
  const flowSpec = specFor(flowKind === "wind" ? "wind_speed" : flowKind === "current" ? "current_speed" : "speed", "m/s");
  useEffect(() => {
    if (!modelId || !timeVar || model?.id !== modelId || !desc?.variables.some(v => v.name === timeVar)) return; let stale = false;
    A.getFrames(modelId, timeVar).then(fs => { if (stale) return; setFrameSet(fs); frameOwner.current = modelId; const ts = fs.frames.map(f => A.tms(f.time)).filter(Number.isFinite);
      // keep the time: inside (± 1 day of) the new frames → unchanged, otherwise the frame nearest to it
      setCursor(c => (Number.isFinite(c) && ts.length && c >= ts[0] - 864e5 && c <= ts[ts.length - 1] + 864e5 ? c : Number.isFinite(c) && ts.length ? ts.reduce((b, t) => (Math.abs(t - c) < Math.abs(b - c) ? t : b), ts[0]) : ts[ts.length - 1] ?? c)); }).catch(e => !stale && setError(e.message));
    return () => { stale = true; };
  }, [modelId, timeVar, model?.id]);
  // observation summaries for the selected datasets (and the fusion observation dataset)
  const obsLoaded = useMemo(() => Array.from(new Set([...obsSel, ...(mode === "fusion" && fusion.obs ? [fusion.obs] : [])])), [obsSel, mode, fusion.obs]);
  useEffect(() => {
    for (const id of obsLoaded) if (!summaries[id]) { busy(1);
      A.obsSummary(id).then(s => { setSummaries(m => ({ ...m, [id]: s })); setObsUi(u => (u.variable[id] !== undefined ? u : { ...u, variable: { ...u.variable, [id]: defaultObsVar(s) } })); })
        .catch(e => setError(e.message)).finally(() => busy(-1)); }
  }, [obsLoaded.join()]);
  // A newly added observation dataset brings the cursor (and window) to its own real time span.
  const focusObs = useRef<string | null>(null);
  useEffect(() => {
    const id = focusObs.current; const t = id && summaries[id]?.time; if (!t || t.length < 2) return; focusObs.current = null;
    const a = A.tms(t[0]), b = A.tms(t[1]), spanH = (b - a) / 3.6e6; setCursor(b);
    setWindowH(w => (spanH > w ? [1, 3, 6, 12, 24, 72, 240, 24 * 365 * 5].find(x => x >= spanH) || 24 * 365 * 5 : w));
    const bb = summaries[id!]?.bounds; if (bb && sm.current) sm.current.fit([bb[0] - 3, bb[1] - 3, bb[2] + 3, bb[3] + 3]);
  }, [summaries, obsSel.join()]);
  // ---------------------------------------------------------------- element browsing: element → data source → local file
  useEffect(() => { if (depth != null) lastDepth.current = depth; }, [depth]);
  /** Depth chosen in the UI: kept across elements / sources and re-applied (nearest level) when a multi-level file returns. */
  const pickDepth = (d: number) => { userDepth.current = d; setDepth(d); };
  const byElement = mode === "model" && browse === "element";
  const element = elementById(elementId);
  const elSources = useMemo(() => (element ? sourcesFor(element, datasets) : []), [element, datasets]);
  const elCounts = useMemo(() => ELEMENTS.map(el => ({ el, n: sourcesFor(el, datasets).length })), [datasets]);
  useEffect(() => { // default element: the first with local data, in a fixed order of usefulness
    if (browse !== "element" || elementId || !datasets.length) return;
    const first = ["wind", "sea_temperature", "current", "waves", "pressure", "ssh", "air_temperature", "salinity", "precipitation", "sea_ice"].find(id => elCounts.find(c => c.el.id === id)?.n);
    if (first) setElementId(first as ElementId);
  }, [browse, elementId, datasets.length]);
  const elSource = elSources.find(s => s.provider === srcProvider) || elSources[0] || null;
  const pickSource = (p: string) => { if (cmp.on && p === cmp.provider && srcProvider) setCmp(c => ({ ...c, provider: srcProvider })); setSrcProvider(p); };
  const keepView = (d: A.VizDataset) => { const m = sm.current?.map, g = d.summary?.grid; if (!m || !g) return false;
    const b = m.getBounds(), c = m.getCenter(), L = ((c.lng - g.bounds[0]) % 360 + 360) % 360 + g.bounds[0];
    const inside = (g.bounds[2] - g.bounds[0] >= 359 || L <= g.bounds[2]) && c.lat >= g.bounds[1] && c.lat <= g.bounds[3];
    const viewArea = Math.min(360, b.getEast() - b.getWest()) * (Math.min(85, b.getNorth()) - Math.max(-85, b.getSouth())), dataArea = (g.bounds[2] - g.bounds[0]) * (g.bounds[3] - g.bounds[1]);
    return inside && dataArea > viewArea * 0.12; };
  const elPick = useRef(""), [pickTick, setPickTick] = useState(0);
  useEffect(() => {
    if (!byElement || !element || !elSource) return;
    const key = `${element.id}|${elSource.provider}|${pickTick}`; if (elPick.current === key) return; elPick.current = key;
    if (elSource.provider !== srcProvider) setSrcProvider(elSource.provider);
    const b = sm.current?.map.getBounds(), f = pickFile(elSource, cursor, b ? [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] : null);
    if (keepView(f.ds)) fitted.current = f.ds.id; else fitted.current = "";
    setModelId(f.ds.id); setScalarId(f.scalar); setFlowSource(null);
    setVectorId(vectorFor(element, f.ds.summary?.vectors || []) ?? "none"); setWaves(element.id === "waves" && !!f.ds.summary?.vectors?.some(v => v.kind === "wave"));
    if (cmp.on && (cmp.provider === elSource.provider || !elSources.some(s => s.provider === cmp.provider))) setCmp(c => ({ ...c, provider: elSources.find(s => s.provider !== elSource.provider)?.provider || null, on: elSources.length > 1 && c.on }));
  }, [byElement, element?.id, elSource?.provider, datasets.length, pickTick]);
  // selecting another colour variable in the panel moves the element selector with it
  useEffect(() => { if (!byElement || !scalar) return; const e = elementOf(scalar.kind); if (e && e !== elementId && model?.id === modelId) { elPick.current = `${e}|${model?.provider}|${pickTick}`; setElementId(e); setSrcProvider(model!.provider); } }, [scalar?.kind]);
  const elEmpty = byElement && !!element && !elSources.length;
  // ---- comparison source B (same element, other provider; nearest file, frame, depth)
  const cmpActive = byElement && cmp.on && !!element && elSources.length > 1;
  const bSource = cmpActive ? elSources.find(s => s.provider === cmp.provider && s.provider !== elSource?.provider) || elSources.find(s => s.provider !== elSource?.provider) || null : null;
  // ---------------------------------------------------------------- time domain
  const frameTimes = useMemo(() => (frameSet?.frames || []).map(f => A.tms(f.time)), [frameSet]);
  const obsRanges = obsLoaded.map(id => summaries[id]?.time).filter((t): t is string[] => !!t && t.length === 2).map(t => [A.tms(t[0]), A.tms(t[1])] as [number, number]);
  const showModel = (mode !== "obs" || obsRanges.length === 0) && !elEmpty;
  const domain = useMemo<[number, number]>(() => {
    const spans: number[] = [];
    if (mode !== "obs" && frameTimes.length) spans.push(frameTimes[0], frameTimes[frameTimes.length - 1]);
    if (mode !== "model") for (const r of obsRanges) spans.push(r[0], r[1]);
    if (!spans.length && frameTimes.length) spans.push(frameTimes[0], frameTimes[frameTimes.length - 1]);
    if (!spans.length) return [Date.now() - 864e5, Date.now()];
    let a = Math.min(...spans), b = Math.max(...spans); const pad = Math.max(3.6e6, (b - a) * 0.03); if (b - a < 3.6e6) { a -= 3 * 3.6e6; b += 3 * 3.6e6; } return [a - pad, b + pad];
  }, [mode, frameTimes.join(), obsRanges.map(r => r.join()).join()]);
  // no frames / observations yet → the domain is a placeholder; clamping now would discard a ?t= from the URL
  useEffect(() => { if (!frameTimes.length && !obsRanges.length) return; setCursor(c => (Number.isFinite(c) && c >= domain[0] && c <= domain[1] ? c : mode === "obs" && obsRanges.length ? Math.max(...obsRanges.map(r => r[1])) : frameTimes[0] ?? domain[1])); }, [domain]);
  const nearIdx = frameTimes.length ? frameTimes.reduce((b, t, i) => (Math.abs(t - cursor) < Math.abs(frameTimes[b] - cursor) ? i : b), 0) : -1;
  const pair = useMemo(() => {
    if (frameTimes.length < 2) return null; const k = frameTimes.findIndex(t => t > cursor); if (k <= 0) return null;
    const a = frameTimes[k - 1], b = frameTimes[k], minGap = Math.min(...frameTimes.slice(1).map((t, i) => t - frameTimes[i]));
    if (b - a > minGap * 1.5 || cursor <= a) return null; return { i0: k - 1, i1: k, w: (cursor - a) / (b - a) };
  }, [frameTimes, cursor]);
  const useInterp = interp && !!pair;
  const frame = nearIdx >= 0 ? frameSet!.frames[nearIdx] : null;
  // ---------------------------------------------------------------- comparison: B on A's time / depth, checked before display
  const bFile = useMemo(() => (bSource ? pickFile(bSource, frame ? A.tms(frame.time) : cursor, desc?.grid?.bounds || null) : null), [bSource, frame?.time, desc?.grid]);
  const [bDs, setBDs] = useState<A.VizDataset | null>(null), [bFrames, setBFrames] = useState<{ id: string; fs: A.FrameSet } | null>(null);
  useEffect(() => {
    if (!bFile) { setBDs(null); setBFrames(null); return; } let stale = false; const id = bFile.ds.id;
    A.getDataset(id).then(d => { if (stale) return; setBDs(d); const opt = d.describe ? M.scalarOptions(d.describe).find(o => o.id === bFile.scalar) : null;
      return A.getFrames(id, opt?.vars[0]).then(fs => !stale && setBFrames({ id, fs })); }).catch(e => !stale && setError(i18nText("对比数据源：") + e.message));
    return () => { stale = true; };
  }, [bFile?.ds.id, bFile?.scalar]);
  const bReady = !!(bFile && bDs && bDs.id === bFile.ds.id && bFrames?.id === bFile.ds.id);
  const bScalar = bReady && bDs!.describe ? M.scalarOptions(bDs!.describe).find(o => o.id === bFile!.scalar) || null : null;
  const bDepthAxis = bReady && bScalar ? M.depthsFor(bDs!.describe!, bScalar.axis) : null;
  const bMatch = useMemo(() => {
    if (!bReady || !frame || !bFrames!.fs.frames.length) return null; const t = A.tms(frame.time), fr = bFrames!.fs.frames.reduce((b, f) => (Math.abs(A.tms(f.time) - t) < Math.abs(A.tms(b.time) - t) ? f : b));
    const zA = depthAxis ? depth : null, zB = bDepthAxis ? (zA == null ? bDepthAxis.values[0] : bDepthAxis.values.reduce((b, x) => (Math.abs(x - zA) < Math.abs(b - zA) ? x : b), bDepthAxis.values[0])) : null;
    return { frame: fr, dtH: Number.isFinite(t) ? Math.abs(A.tms(fr.time) - t) / 3.6e6 : null, depth: zB };
  }, [bReady, bFrames, frame?.time, depth, !!depthAxis, bDepthAxis]);
  const commonTime = useMemo(() => {
    if (!elSource || !bSource) return null; const tol = cmp.maxDt * 3.6e6, c: number[] = [];
    for (const a of elSource.files) for (const t of a.ds.summary?.times || []) { const x = A.tms(t); if (Number.isFinite(x) && bSource.files.some(b => x >= b.t0 - tol && x <= b.t1 + tol)) c.push(x); }
    return c.length ? c.reduce((b, x) => (Math.abs(x - cursor) < Math.abs(b - cursor) ? x : b), c[0]) : null;
  }, [elSource, bSource, cmp.maxDt, Math.round(cursor / 3.6e6)]);
  const jumpCommon = () => { if (commonTime == null) return; setPlaying(false); setCursor(commonTime); setPickTick(t => t + 1); };
  const unitA = scalar ? canonUnit(scalar.kind, scalar.spec.unit || scalar.units) : "", unitB = bScalar ? canonUnit(bScalar.kind, bScalar.spec.unit || bScalar.units) : "";
  const cmpBlockers = cmpActive && bScalar && scalar && bMatch ? compareBlockers({ unitA, unitB, dtH: bMatch.dtH, maxDtH: cmp.maxDt, depthA: depthAxis ? depth : null, depthB: bMatch.depth,
    overlap: !!(desc?.grid && bDs?.describe?.grid && boxesOverlap(desc.grid.bounds, bDs.describe.grid.bounds)) }) : [];
  const cmpNotes = useMemo(() => { const n: string[] = []; if (!cmpActive || !model || !bDs) return n;
    const daily = (d: A.VizDataset) => /P1D|daily|_day/i.test(d.dataset);
    if (daily(model) !== daily(bDs)) n.push(i18nText("{0} 为日均产品（时间戳代表当日平均），另一方为瞬时场，差值包含时间代表性差异。", daily(model) ? "A" : "B"));
    const ga = desc?.grid, gb = bDs.describe?.grid; if (ga && gb && Math.abs(ga.dx - gb.dx) / Math.max(ga.dx, gb.dx) > 0.2) n.push(i18nText("两者分辨率不同（{0}° / {1}°）：差值在较粗网格上计算，较细一方先双线性插值到粗网格。", +ga.dx.toFixed(3), +gb.dx.toFixed(3)));
    if (element?.id === "sea_temperature") n.push(i18nText("模式海温通常为最上层（约 0.5 m）体温度，不同模式的最上层深度略有差异。"));
    return n; }, [cmpActive, model?.id, bDs?.id, element?.id]);
  const Fb = useRef<{ s: A.Field | null; sd: A.Field | null }>({ s: null, sd: null }), [bVersion, setBVersion] = useState(0), [bBusy, setBBusy] = useState(false), bReq = useRef(0);
  useEffect(() => {
    const req = ++bReq.current;
    if (!cmpActive || !bScalar || !bMatch || !mapReady || cmpBlockers.length) { Fb.current = { s: null, sd: null }; setBBusy(false); setBVersion(v => v + 1); return; }
    const box = sm.current!.viewBox(), q = (o: { box?: any; cells?: number } = {}) => A.loadField({ id: bMatch.frame.task, vars: bScalar.vars, time: bMatch.frame.time, depth: bMatch.depth, bbox: o.box || null, maxCells: o.cells || BASE_CELLS });
    setBBusy(true);
    (async () => { const s = await q(); const sd = box && s.factor > 1 && !playing ? await q({ box, cells: DETAIL_CELLS }).catch(() => null) : null;
      if (req !== bReq.current) return; Fb.current = { s, sd }; setBVersion(v => v + 1); })()
      .catch(e => req === bReq.current && setError(i18nText("对比数据源：") + e.message)).finally(() => req === bReq.current && setBBusy(false));
  }, [cmpActive, bScalar?.id, bMatch?.frame.task, bMatch?.frame.time, bMatch?.depth, mapReady, viewTick, playing, cmpBlockers.join()]);

  // ---------------------------------------------------------------- map lifecycle
  useEffect(() => {
    if (!mapEl.current) return;
    let m: StudioMap;
    try { m = new StudioMap(mapEl.current, theme, { globe, center: Q.get("lon") ? [Number(Q.get("lon")), Number(Q.get("lat"))] : undefined, zoom: Q.get("zoom") ? Number(Q.get("zoom")) : undefined }); }
    catch { setError(i18nText("当前浏览器无法创建 WebGL2 地图（需要启用硬件加速）")); return; }
    sm.current = m;
    m.ready.then(() => {
      const f = new FieldLayer("os-field"); m.map.addLayer(f, m.anchor("ocean-field")); fieldL.current = f;
      const fb = new FieldLayer("os-field-b"); m.map.addLayer(fb, m.anchor("ocean-field")); fieldB.current = fb;
      const style = { density: 1, speed: 1, trail: 22, width: 1.25, bright: 1, color: "white" as const, lut: lut("wind"), range: [0, 20] as [number, number] };
      const p = new ParticleLayer("os-particles", style); m.map.addLayer(p, m.anchor("particles")); partL.current = p;
      const w = new ParticleLayer("os-waves", { ...style, density: 0.55, speed: 0.8, trail: 14, width: 1.6, color: "white", lut: lut("waves"), range: [0, 6] }); m.map.addLayer(w, m.anchor("particles")); w.setEnabled(false); waveL.current = w;
      arrows.current = new FlowLayer(m.map, { mode: "off", density: 1, speed: 1, color: "white", trail: 0.9, width: 1.2, palette: "speed", range: [0, 20] });
      // comparison source B (swipe): its own flow tracers, drawn only right of the swipe line
      const pb = new ParticleLayer("os-particles-b", style); m.map.addLayer(pb, m.anchor("particles")); pb.setEnabled(false); partB.current = pb;
      arrowsB.current = new FlowLayer(m.map, { mode: "off", density: 1, speed: 1, color: "white", trail: 0.9, width: 1.2, palette: "speed", range: [0, 20] });
      if (DEBUG) (window as any).__studio = { m, f, p, w, F, pb, fb };
      setMapReady(true);
    });
    let t = 0; m.map.on("moveend", () => { clearTimeout(t); t = window.setTimeout(() => setViewTick(v => v + 1), 220); });
    m.map.on("mousemove", e => live.current.hover?.(e)); m.map.on("mouseout", () => { if (hoverEl.current) hoverEl.current.style.opacity = "0"; sideApi.current?.cross(null); });
    m.map.on("click", e => live.current.click?.(e)); m.map.on("mousedown", e => live.current.down?.(e)); m.map.on("mouseup", e => live.current.up?.(e));
    return () => { arrows.current?.destroy(); arrowsB.current?.destroy(); for (const l of obsL.current.values()) l.destroy(); obsL.current.clear(); m.map.remove(); sm.current = null; };
  }, []);
  useEffect(() => { if (mapReady) { sm.current!.setTheme(theme); for (const l of obsL.current.values()) l.moveToTop(); } }, [theme, mapReady]);
  useEffect(() => { if (!mapReady) return; sm.current!.setProjection(globe); partL.current?.reseed(); waveL.current?.reseed(); }, [globe, mapReady]);
  useEffect(() => { if (mapReady) sm.current!.setBasemap(basemap); }, [basemap, mapReady]);
  const fitted = useRef("");
  useEffect(() => { if (mapReady && model?.describe?.grid && fitted.current !== model.id && !Q.get("lon")) { fitted.current = model.id; if (mode !== "obs") sm.current!.fit(model.describe.grid.bounds); } }, [model?.id, mapReady]);

  // ---------------------------------------------------------------- model slices (only what is on screen)
  const isGrid = !!(model && model.kind === "grid" && desc?.grid);
  useEffect(() => {
    if (!mapReady || !isGrid || !frame || !showModel || frameOwner.current !== modelId || model?.id !== modelId) return;
    if ((scalarId !== "none" && scalar && !scalar.vars.every(n => desc!.variables.some(v => v.name === n))) || (scalarId !== "none" && scalarId && !scalar)) return;
    const req = ++reqRef.current, box = sm.current!.viewBox(), z = depthAxis ? depth : null;
    const sVars = scalarId !== "none" && scalar ? scalar.vars : null, vVars = vectorId !== "none" && vector ? M.vectorVars(vector) : null;
    const vId = flowSource && flowSource !== modelId ? flowSource : null;
    busy(1); setError("");
    (async () => {
      const at = (fr: A.Frame, vars: string[], o: { box?: any; id?: string; depth?: number | null; cells?: number } = {}) =>
        A.loadField({ id: o.id || fr.task, vars, time: fr.time, depth: o.depth === undefined ? z : o.depth, bbox: o.box || null, maxCells: o.cells || BASE_CELLS });
      const out: Fields = {};
      const sP = sVars ? at(frame, sVars) : null; out.s = sP ? await sP : null;
      const detail = !useInterp && !playing && box && out.s && out.s.factor > 1;
      const sdP = sVars && detail ? at(frame, sVars, { box, cells: DETAIL_CELLS }) : null;
      const same = sVars && vVars && sVars.join() === vVars.join() && !vId;
      const vP = vVars ? (same ? sP : at(frame, vVars, vId ? { id: vId, depth: null } : {})) : null;
      if (useInterp && pair) { const f2 = frameSet!.frames[pair.i1 === nearIdx ? pair.i0 : pair.i1];
        const [a2, b2] = await Promise.all([sVars ? at(f2, sVars) : null, vVars && !vId ? (same ? (sVars ? at(f2, sVars) : null) : at(f2, vVars)) : null]);
        out.s2 = a2; out.v2 = b2; out.w = pair.i1 === nearIdx ? 1 - pair.w : pair.w; }
      if (waves && waveVec) out.wave = await at(frame, M.vectorVars(waveVec), { depth: null }).catch(() => null);
      const [sd, v] = await Promise.all([sdP?.catch(() => null), vP?.catch(e => { setError(i18nText("矢量图层：") + e.message); return null; })]);
      if (req !== reqRef.current) return;
      out.sd = sd; out.v = v; F.current = out;
      if (out.s && scalar) {
        // element browsing keeps one colour scale per element (and depth band) across data sources
        const key = byElement && element ? `el|${element.id}|${z == null ? "" : Math.round(Math.log2(1 + z) * 2)}` : `${model!.provider}|${scalar.id}|${z ?? ""}`;
        if (rangeKey.current !== key) { rangeKey.current = key; const vals = displayArray(out.s, scalar.derived ? [0, 1] : 0, scalar.spec.convert, scalar.spec.unit); const [w, s, e, n] = out.s.bounds;
          setRange(scalar.spec.range && (e - w) * (n - s) > 360 * 120 ? scalar.spec.range : robustRange(vals, scalar.spec.symmetric)); }
      }
      setFieldsVersion(x => x + 1);
    })().catch(e => req === reqRef.current && setError(e.message || String(e))).finally(() => busy(-1));
  }, [mapReady, isGrid, frame?.task, frame?.time, scalarId, vectorId, flowSource, depth, viewTick, useInterp, pair?.i0, pair?.i1, Math.round((pair?.w || 0) * 20), playing, waves, showModel]);
  // ---------------------------------------------------------------- GPU rendering (no network)
  const palette = fieldUi.palette || scalar?.spec.palette || "viridis";
  const table = useMemo(() => lut(palette, fieldUi.bands), [palette, fieldUi.bands]);
  const ffCache = useRef(new WeakMap<A.Field, Record<string, FlowField>>());
  const ff = (f: A.Field, key: string, make: () => FlowField) => { const c = ffCache.current.get(f) || {}; if (!c[key]) { c[key] = make(); ffCache.current.set(f, c); } return c[key]; };
  const last = useRef({ sig: "", time: "" as string | null | undefined });
  // F.current is replaced asynchronously; the selection changes synchronously on click. Only slices that carry the
  // selected variables are used, so a switch never indexes arrays of the previous element (that threw and unmounted the app).
  /** Contours of A; during a swipe only west of the line (Mercator: a vertical screen line is a meridian; globe: hidden). */
  const applyContours = () => { const m = sm.current; if (!m) return; const c = contourAll.current, sw = swipeRef.current;
    if (!c) { m.setContours(null); return; } if (!sw) { m.setContours(c.lines, c.unit); return; }
    if (m.isGlobe()) { m.setContours(null); return; }
    const h = m.map.getCanvas().clientHeight, cut = m.map.unproject([sw.x, h / 2]).lng, ref = m.map.getCenter().lng;
    m.setContours(clipLinesLon(c.lines, cut, "left", ref), c.unit); };
  const freshF = (): Fields => freshFields(F.current, scalarId !== "none" && scalar ? scalar.vars : null, vectorId !== "none" && vector?.u && vector.v ? [vector.u, vector.v] : null,
    waves && waveVec ? M.vectorVars(waveVec) : null);
  useEffect(() => {
    const m = sm.current, fl = fieldL.current, pl = partL.current; if (!mapReady || !m || !fl || !pl) return;
    try {
    const f = freshF(), show = showModel && isGrid && scalar && scalarId !== "none" && f.s && range;
    const sig = [scalarId, depth, vectorId, flowSource, modelId].join("|"), time = f.s?.time ?? f.v?.time;
    const fade = last.current.sig === sig && last.current.time !== time && !useInterp ? Math.min(600, playing ? 800 / fps : 500) : 0;
    last.current = { sig, time };
    if (show) {
      const k: number | [number, number] = scalar!.derived ? [0, 1] : 0, conv = scalar!.spec.convert, unit = scalar!.spec.unit;
      fl.setStyle({ lo: range![0], hi: range![1], opacity: fieldUi.opacity, bands: fieldUi.bands, lut: table });
      if (useInterp && f.s2) fl.setPair(f.s!, displayArray(f.s2, k, conv, unit), displayArray(f.s!, k, conv, unit), 1 - f.w!);
      else { const list = [{ f: f.s!, values: displayArray(f.s!, k, conv, unit) }]; if (f.sd && f.sd.factor < f.s!.factor) list.push({ f: f.sd, values: displayArray(f.sd, k, conv, unit) }); fl.setFields(list, fade); }
      m.map.moveLayer("os-field", m.anchor(ocean ? "ocean-field" : "air-field")); if (m.map.getLayer("os-field-b")) m.map.moveLayer("os-field-b", m.anchor(ocean ? "ocean-field" : "air-field")); m.coastContrast(!ocean);
      if (fieldUi.contours) {
        const src = f.sd && f.sd.factor < f.s!.factor ? f.sd : f.s!, vals = displayArray(src, k, conv, unit), [lo, hi] = robustRange(vals);
        let st = fieldUi.contourStep || scalar!.spec.contour || 0; if (!st || (hi - lo) / st > 60) st = Number(((hi - lo) / 12).toPrecision(1)) || 1;
        const levels: number[] = []; for (let v = Math.ceil(lo / st) * st; v <= hi && levels.length < 60; v += st) levels.push(+v.toFixed(6));
        const lines = isolines(src, vals, levels), major = st * (levels.length > 18 ? 5 : 2), dec = Math.max(0, -Math.floor(Math.log10(st)));
        for (const ft of lines.features) { const pr: any = ft.properties; pr.major = Math.abs(pr.level / major - Math.round(pr.level / major)) < 1e-6; pr.label = pr.level.toFixed(dec); }
        contourAll.current = { lines, unit }; applyContours();
      } else { contourAll.current = null; m.setContours(null); }
    } else { fl.clear(); contourAll.current = null; m.setContours(null); m.coastContrast(false); }
    // particles + arrows
    const vf = showModel && isGrid && vector && vectorId !== "none" ? f.v : null;
    if (vf) {
      const names = vf.variables.map(v => v.name), key = vector!.id;
      const flow = ff(vf, key, () => vectorField(vf, flowKind, { uIndex: names.indexOf(vector!.u!), vIndex: names.indexOf(vector!.v!) }));
      const range2 = flowSpec.range || [0, flow.reference * 2] as [number, number], color = !show && flowUi.color === "white" && theme === "light" ? "speed" : flowUi.color;
      pl.setStyle({ density: flowUi.density, speed: flowUi.speed, trail: flowUi.trail, width: flowUi.width, bright: flowUi.bright, color, lut: lut(flowSpec.palette), range: range2 });
      pl.setEnabled(flowUi.particles);
      if (useInterp && f.v2) { const n2 = f.v2.variables.map(v => v.name); pl.setPair(ff(f.v2, key, () => vectorField(f.v2!, flowKind, { uIndex: n2.indexOf(vector!.u!), vIndex: n2.indexOf(vector!.v!) })), flow, 1 - f.w!); }
      else pl.setField(flow, fade ? Math.max(fade, 600) : 0);
      arrows.current?.setOptions({ mode: flowUi.arrows ? "arrows" : "off", density: flowUi.density, color: color === "speed" ? "speed" : theme === "light" && !show ? "dark" : "white", palette: flowSpec.palette, range: range2 });
      arrows.current?.setField(flowUi.arrows ? flow : null);
    } else { pl.setEnabled(false); pl.setField(null); arrows.current?.setOptions({ mode: "off" }); arrows.current?.setField(null); }
    const wl = waveL.current;
    if (wl && waves && waveVec && f.wave) { const n = f.wave.variables.map(v => v.name);
      wl.setField(ff(f.wave, "wave", () => vectorField(f.wave!, "wave", { dirIndex: n.indexOf(waveVec.direction!), magIndex: waveVec.magnitude ? n.indexOf(waveVec.magnitude) : undefined })), fade);
      wl.setStyle({ color: show ? "white" : theme === "light" ? "dark" : "white", lut: lut("waves"), range: [0, 6] }); wl.setEnabled(true); }
    else if (wl) wl.setEnabled(false);
    } catch (e: any) { // a drawing failure must not take the whole studio (and its WebGL context) down
      console.error("Ocean Studio render", e); setError(i18nText("图层绘制失败：") + (e?.message || String(e)));
      try { fl.clear(); pl.setEnabled(false); pl.setField(null); arrows.current?.setField(null); waveL.current?.setEnabled(false); } catch { /* already torn down */ }
    }
  }, [fieldsVersion, mapReady, range, table, fieldUi, flowUi, scalarId, vectorId, modelId, theme, ocean, waves, showModel, useInterp]);

  // ---------------------------------------------------------------- comparison rendering (swipe / overlay / diff / side)
  const dispOf = (f: A.Field, sc: M.ScalarOpt) => displayArray(f, sc.derived ? [0, 1] : 0, sc.spec.convert, sc.spec.unit);
  const cmpOk = cmpActive && !!bScalar && !!scalar && !cmpBlockers.length && !!Fb.current.s;
  const cmpGrid = useMemo(() => {
    const fa = freshF(), fb = freshFields(Fb.current, bScalar?.vars || null, null, null); if (!cmpOk || !fa.s || !fb.s) return null;
    const a = fa.sd && fa.sd.factor < fa.s.factor ? fa.sd : fa.s, b = fb.sd && fb.sd.factor < fb.s.factor ? fb.sd : fb.s;
    return common(a, dispOf(a, scalar!), b, dispOf(b, bScalar!));
  }, [cmpOk, fieldsVersion, bVersion]);
  const cmpStats = useMemo(() => { const m = sm.current?.map; if (!cmpGrid || !m) return null; const b = m.getBounds();
    return diffStats(cmpGrid.grid, cmpGrid.A, cmpGrid.B, [b.getWest(), Math.max(-90, b.getSouth()), b.getEast(), Math.min(90, b.getNorth())]); }, [cmpGrid, viewTick]);
  const diffLimCmp = useMemo(() => { if (!cmpGrid) return 1; const [lo, hi] = robustRange(cmpGrid.D, true); return Math.max(Math.abs(lo), Math.abs(hi)) || 1; }, [cmpGrid]);
  const balance = useMemo(() => lut("balance"), []);
  const bStyle = range ? { lo: range[0], hi: range[1], opacity: fieldUi.opacity, bands: fieldUi.bands, lut: table } : null;
  const bFields = useMemo(() => { const fb = freshFields(Fb.current, bScalar?.vars || null, null, null); if (!cmpOk || !fb.s) return []; const list = [{ f: fb.s, values: dispOf(fb.s, bScalar!) }]; if (fb.sd && fb.sd.factor < fb.s.factor) list.push({ f: fb.sd, values: dispOf(fb.sd, bScalar!) }); return list; }, [cmpOk, bVersion]);
  useEffect(() => {
    const fa = fieldL.current, fb = fieldB.current, m = sm.current; if (!mapReady || !fa || !fb || !m) return;
    const view = cmp.view;
    if (!cmpOk || view === "side") { fb.clear(); fb.setClip(null); fa.setClip(null); fa.setVisible(true); return; }
    m.map.moveLayer("os-field-b", m.anchor(ocean ? "ocean-field" : "air-field"));
    if (view === "diff" && cmpGrid) { fa.setVisible(false); fa.setClip(null); fb.setClip(null);
      fb.setStyle({ lo: -diffLimCmp, hi: diffLimCmp, opacity: fieldUi.opacity, bands: fieldUi.bands, lut: balance }); fb.setFields([{ f: cmpGrid.field, values: cmpGrid.D }]); return; }
    fa.setVisible(true); if (!range) return;
    fb.setStyle({ ...bStyle!, opacity: view === "overlay" ? cmp.opacity : fieldUi.opacity }); fb.setFields(bFields);
    if (view === "overlay") { fa.setClip(null); fb.setClip(null); }
  }, [cmpOk, cmp.view, cmp.opacity, cmpGrid, bFields, range, table, fieldUi.opacity, fieldUi.bands, mapReady, diffLimCmp, ocean]);
  useEffect(() => { const fa = fieldL.current, fb = fieldB.current, m = sm.current; if (!fa || !fb || !m) return;
    // Screen-space scissor / clip-path: one vertical line on screen, so it holds on the globe as well.
    const on = cmpOk && cmp.view === "swipe", x = cmp.swipe * m.map.getCanvas().clientWidth, L = on ? { x, side: "left" as const } : null, Rr = on ? { x, side: "right" as const } : null;
    fa.setClip(L); fb.setClip(Rr); partL.current?.setClip(L); waveL.current?.setClip(L); arrows.current?.setClip(L); partB.current?.setClip(Rr); arrowsB.current?.setClip(Rr);
    swipeRef.current = on ? { x } : null; applyContours();
  }, [cmpOk, cmp.view, cmp.swipe, viewTick, mapReady]);
  // contours (a native line layer) follow the swipe line while the map moves
  useEffect(() => { const m = sm.current?.map; if (!mapReady || !m) return; let raf = 0;
    const mv = () => { if (!swipeRef.current || raf) return; raf = requestAnimationFrame(() => { raf = 0; applyContours(); }); };
    m.on("move", mv); return () => { m.off("move", mv); cancelAnimationFrame(raf); }; }, [mapReady]);
  // B-side flow tracers in swipe mode, from the comparison slice (same vector variables as the B colour field)
  useEffect(() => { const pb = partB.current, ab = arrowsB.current, fb = freshFields(Fb.current, bScalar?.vars || null, null, null).s; if (!mapReady || !pb || !ab) return;
    const bVec = bScalar?.derived ? bDs?.describe?.vectors.find(v => v.u === bScalar.vars[0] && v.v === bScalar.vars[1]) : null;
    if (!(cmpOk && cmp.view === "swipe" && vector && vectorId !== "none" && fb && bVec)) { pb.setEnabled(false); pb.setField(null); ab.setOptions({ mode: "off" }); ab.setField(null); return; }
    try { const names = fb.variables.map(v => v.name), kind = M.flowKind(bVec);
      const flow = ff(fb, "b:" + bVec.id, () => vectorField(fb, kind, { uIndex: names.indexOf(bVec.u!), vIndex: names.indexOf(bVec.v!) })), range2 = flowSpec.range || [0, flow.reference * 2] as [number, number];
      pb.setStyle({ density: flowUi.density, speed: flowUi.speed, trail: flowUi.trail, width: flowUi.width, bright: flowUi.bright, color: flowUi.color, lut: lut(flowSpec.palette), range: range2 });
      pb.setEnabled(flowUi.particles); pb.setField(flow);
      ab.setOptions({ mode: flowUi.arrows ? "arrows" : "off", density: flowUi.density, color: flowUi.color === "speed" ? "speed" : "white", palette: flowSpec.palette, range: range2 }); ab.setField(flowUi.arrows ? flow : null);
    } catch (e: any) { console.error("B flow", e); pb.setEnabled(false); pb.setField(null); }
  }, [cmpOk, cmp.view, bVersion, bScalar?.id, bDs?.id, vector?.id, vectorId, flowUi, mapReady]);
  const cmpStatus: CmpStatus | null = cmpActive && bSource ? { aLabel: elSource?.label || "", bLabel: bSource.label, aTime: frame?.time || null, bTime: bMatch?.frame.time || null, dtH: bMatch?.dtH ?? null,
    aDepth: depthAxis ? depth : null, bDepth: bMatch?.depth ?? null, unit: unitA, unitB, blockers: cmpBlockers, notes: cmpNotes, stats: cmpStats,
    grid: cmpGrid ? i18nText("差值网格 {0}×{1}（{2} 网格，{3}°）", cmpGrid.grid.nx, cmpGrid.grid.ny, cmpGrid.target === "A" ? elSource?.label : bSource.label, +Math.abs(cmpGrid.grid.dx).toFixed(3)) : "", loading: bBusy || (!bReady && !!bFile) } : null;
  // ---------------------------------------------------------------- observations on the map
  const obsReq = useRef(0), [obsCounts, setObsCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!mapReady || !obsLoaded.length || !Number.isFinite(cursor)) return;
    const req = ++obsReq.current, t1 = A.isoOf(cursor + 60e3), t0 = A.isoOf(cursor - windowH * 3.6e6);
    const run = () => { busy(1); Promise.all(obsLoaded.map(id => A.obsFeatures(id, { var: (mode === "fusion" && id === fusion.obs && fusion.obsVar ? fusion.obsVar : obsUi.variable[id]) ?? null, t0, t1, qc: obsUi.qc, depth_max: obsUi.depthMax }).then(r => [id, r] as const).catch(e => { setError(e.message); return null; })))
      .then(rs => { if (req !== obsReq.current) return; const next: Record<string, A.ObsFeatures> = {}; for (const r of rs) if (r) next[r[0]] = r[1]; setFeatures(next); }).finally(() => busy(-1)); };
    const t = window.setTimeout(run, playing ? 60 : 160); return () => clearTimeout(t);
  }, [mapReady, obsLoaded.join(), Math.round(cursor / 6e5), windowH, obsUi.qc, obsUi.depthMax, JSON.stringify(obsUi.variable), mode, fusion.obs, fusion.obsVar]);
  const obsStops = useCallback((id: string): [number, string][] | null => {
    const f = features[id], v = f?.variable; if (!v) return null;
    const unify = obsUi.unify && scalar && range && scalarId !== "none" && (scalar.kind === v.kind || (scalar.kind === "wind_speed" && v.kind === "wind_speed") || (scalar.kind === "air_temperature" && v.kind === "air_temperature"));
    const sp = specFor(v.kind, v.display_unit), pal = unify ? palette : sp.palette;
    const [lo, hi] = unify ? range! : sp.range && v.kind !== "pressure" ? sp.range : [v.min ?? 0, (v.max ?? 1) > (v.min ?? 0) ? v.max! : (v.min ?? 0) + 1];
    const st = PALETTES[pal]?.stops || PALETTES.viridis.stops; return st.map((c, i) => [lo + (hi - lo) * i / (st.length - 1), c]);
  }, [features, obsUi.unify, scalar, range, palette, scalarId]);
  useEffect(() => {
    const m = sm.current; if (!mapReady || !m) return;
    for (const [id, l] of obsL.current) if (!obsLoaded.includes(id)) { l.destroy(); obsL.current.delete(id); }
    const counts: Record<string, number> = {};
    for (const id of obsLoaded) {
      const f = features[id]; if (!f) continue;
      let l = obsL.current.get(id); if (!l) { l = new ObsLayer(m.map, id.slice(0, 8)); obsL.current.set(id, l); }
      const hide = mode === "fusion" && !!match && fusion.obs === id;
      l.setData(f, obsStops(id), { tracks: obsUi.tracks, density: obsUi.density, visible: !hide && (mode !== "model" || obsSel.includes(id)) });
      counts[id] = f.count;
    }
    setObsCounts(counts);
  }, [features, mapReady, obsUi.tracks, obsUi.density, obsStops, mode, match, fusion.obs]);
  // selected platform's full track (gaps dashed, jumps marked)
  useEffect(() => {
    const m = sm.current?.map; if (!mapReady || !m) return;
    const data: any = { type: "FeatureCollection", features: [] };
    if (track) for (let i = 1; i < track.lon.length; i++) { let x0 = track.lon[i - 1], x1 = track.lon[i]; if (x1 - x0 > 180) x1 -= 360; else if (x0 - x1 > 180) x1 += 360;
      data.features.push({ type: "Feature", properties: { gap: track.gap[i - 1], jump: track.jump[i - 1] }, geometry: { type: "LineString", coordinates: [[x0, track.lat[i - 1]], [x1, track.lat[i]]] } }); }
    if (track) data.features.push({ type: "Feature", properties: { head: true }, geometry: { type: "Point", coordinates: [track.lon[track.lon.length - 1], track.lat[track.lat.length - 1]] } });
    const src = m.getSource("os-track") as any;
    if (src) src.setData(data); else {
      m.addSource("os-track", { type: "geojson", data });
      m.addLayer({ id: "os-track", type: "line", source: "os-track", filter: ["all", ["==", ["geometry-type"], "LineString"], ["!=", ["get", "gap"], true]], paint: { "line-color": ["case", ["==", ["get", "jump"], true], "#ff4d4f", "#ffffff"], "line-width": 2.4, "line-opacity": 0.95 } });
      m.addLayer({ id: "os-track-gap", type: "line", source: "os-track", filter: ["==", ["get", "gap"], true], paint: { "line-color": "#ffffff", "line-width": 1.4, "line-dasharray": [1.5, 2.5], "line-opacity": 0.7 } });
      m.addLayer({ id: "os-track-head", type: "circle", source: "os-track", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 5, "circle-color": "#ffffff", "circle-stroke-color": "#0b1622", "circle-stroke-width": 2 } });
    }
    for (const id of ["os-track", "os-track-gap", "os-track-head"]) if (m.getLayer(id)) m.moveLayer(id);
  }, [track, mapReady]);
  // ---------------------------------------------------------------- fusion
  const runFusion = async () => {
    if (!fusion.model || !fusion.obs || !fusion.obsVar) return;
    setMatchBusy(true); setError("");
    try {
      const b = sm.current!.map.getBounds(), bbox = fusion.useView ? [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map(x => x.toFixed(3)).join(",") : null;
      const r = await A.runMatch({ model: fusion.model, obs: fusion.obs, obs_var: fusion.obsVar, max_dt_h: fusion.maxDt, time_interp: fusion.interp, qc: fusion.qc, bbox, depth_max: fusion.depthMax });
      setMatch(r); setInsp({ kind: "match" });
      if (fusion.model !== modelId) setModelId(fusion.model);
    } catch (e: any) { setError(e.message); } finally { setMatchBusy(false); }
  };
  useEffect(() => {
    const m = sm.current?.map; if (!mapReady || !m) return;
    const profMode = mode === "fusion" && insp?.kind === "profiles" && !!(profRun?.T || profRun?.S);
    const on = mode === "fusion" && match && !profMode, data: any = { type: "FeatureCollection", features: [] };
    let lim = 1;
    if (profMode) { lim = profLim(profRun!);
      for (const p of (profRun!.T || profRun!.S)!.profiles.filter(p => p.n > 0)) data.features.push({ type: "Feature", properties: { kind: "prof", d: p.bias, rmse: p.rmse, n: p.n, id: p.platform, t: p.time, out: false }, geometry: { type: "Point", coordinates: [p.lon, p.lat] } }); }
    if (on) { lim = Math.max(1e-6, 2.5 * (match!.stats.robust_std || match!.stats.std_diff || 1)); const t1 = cursor + 60e3, t0 = cursor - windowH * 3.6e6;
      for (let i = 0; i < match!.pairs.obs.length; i++) { const t = A.tms(match!.pairs.time[i]); if (t < t0 || t > t1) continue;
        data.features.push({ type: "Feature", properties: { d: match!.pairs.model[i] - match!.pairs.obs[i], o: match!.pairs.obs[i], mo: match!.pairs.model[i], id: match!.pairs.platform[i], t: match!.pairs.time[i], out: match!.pairs.outlier[i] }, geometry: { type: "Point", coordinates: [match!.pairs.lon[i], match!.pairs.lat[i]] } }); } }
    const src = m.getSource("os-diff") as any;
    if (src) src.setData(data); else { m.addSource("os-diff", { type: "geojson", data });
      m.addLayer({ id: "os-diff", type: "circle", source: "os-diff", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 3.6, 7, 7], "circle-stroke-width": ["case", ["==", ["get", "out"], true], 2, 0.8], "circle-stroke-color": ["case", ["==", ["get", "out"], true], "#ffffff", "rgba(4,12,22,0.7)"], "circle-color": "#888" } }); }
    m.setPaintProperty("os-diff", "circle-color", ["interpolate", ["linear"], ["get", "d"], -lim, "#2166ac", -lim / 2, "#67a9cf", 0, "#f7f7f7", lim / 2, "#ef8a62", lim, "#b2182b"]);
    m.setPaintProperty("os-diff", "circle-radius", profMode ? ["interpolate", ["linear"], ["zoom"], 1, 6, 7, 11] : ["interpolate", ["linear"], ["zoom"], 1, 3.6, 7, 7]);
    m.moveLayer("os-diff");
  }, [match, mode, mapReady, Math.round(cursor / 6e5), windowH, profRun, insp?.kind]);
  const profMap = mode === "fusion" && insp?.kind === "profiles" && !!(profRun?.T || profRun?.S);
  const diffLim = profMap ? profLim(profRun!) : match ? 2.5 * (match.stats.robust_std || match.stats.std_diff || 1) : 1;

  // ---------------------------------------------------------------- fusion: model vs Argo vertical profiles
  const profObs = fusion.obs && summaries[fusion.obs]?.vertical ? fusion.obs : null;
  useEffect(() => { // default 3-D models: the T / S grids closest in time to the profiles
    if (!profObs || prof.modelT || prof.modelS) return; const t = summaries[profObs]?.time; if (!t) return; const mid = (A.tms(t[0]) + A.tms(t[1])) / 2;
    const near = (kind: string) => layeredGrids(datasets, kind).sort((a, b) => Math.abs(A.tms(a.summary?.times?.[0]) - mid) - Math.abs(A.tms(b.summary?.times?.[0]) - mid))[0]?.id ?? null;
    setProf(p => ({ ...p, modelT: near("sea_temperature"), modelS: near("salinity") }));
  }, [profObs, datasets.length]);
  const runProfiles = async () => {
    if (!profObs) return; const sum = summaries[profObs]; setProfBusy(true); setError("");
    const run: ProfileRun = { T: null, S: null, columns: {}, obs: {}, obsLabel: sum.dataset, adjusted: prof.adjusted, progress: [0, sum.platforms.length] };
    setProfRun({ ...run }); setInsp({ kind: "profiles" });
    try {
      const plats: A.Platform[] = [], ids = sum.platforms.map(p => p.id), q = ids.slice();
      await Promise.all(Array.from({ length: 6 }, async () => { while (q.length) { const id = q.shift()!; const p = await A.obsPlatform(profObs, id).catch(() => null); if (p?.profiles?.length) plats.push(p); setProfRun(r => r && { ...r, progress: [plats.length, ids.length] }); } }));
      for (const [k, kind, mid] of [["T", "sea_temperature", prof.modelT], ["S", "salinity", prof.modelS]] as const) {
        if (!mid) continue;
        const obs: ObsProfile[] = []; let obsUnit = "";
        for (const p of plats) {
          const vs = p.variables.filter(v => v.kind === kind), adj = vs.find(v => /adjusted/i.test(v.name)), raw = vs.find(v => !/adjusted/i.test(v.name)); if (!vs.length || !p.vertical) continue;
          for (const g of p.profiles!) {
            const hasAdj = !!adj && g.rows.some(i => adj.display_values[i] != null), v = prof.adjusted && hasAdj ? adj! : raw || adj!; obsUnit = obsUnit || v.display_unit;
            const o: ObsProfile = { platform: p.id, key: g.key, cycle: g.cycle, time: g.time, lon: g.lon, lat: g.lat, variable: v.name, levels: g.rows.map(i => ({ z: p.vertical!.depth_m[i] ?? NaN, v: v.display_values[i], qc: v.qc[i] })) };
            obs.push(o); (run.obs[g.key] ||= {})[k] = o;
          }
        }
        const md = await A.getDataset(mid), opt = md.describe ? M.scalarOptions(md.describe).find(o => o.kind === kind && M.depthsFor(md.describe!, o.axis)) : null;
        if (!opt) throw new Error(i18nText("{0} 没有带深度层的{1}变量", md.dataset, k === "T" ? i18nText("温度") : i18nText("盐度")));
        const fs = await A.getFrames(mid, opt.vars[0]), unit = canonUnit(kind, opt.spec.unit || opt.units), ou = canonUnit(kind, obsUnit || unit);
        if (unit !== ou) throw new Error(i18nText("单位不一致：模式 {0} / 观测 {1}，无法比较", unit, ou));
        const column = async (p: ObsProfile, fr: { time: string; task: string }): Promise<ModelColumn> => {
          const r: any = await A.pointQuery(fr.task, p.lon, p.lat, { time: fr.time, profile: true, vars: opt.vars }); if (!r.inside) return null;
          const pr = r.profiles?.find((x: any) => x.name === opt.vars[0]); if (!pr) return null; const conv = opt.spec.convert;
          const col = { z: pr.depth.map((z: number) => Math.abs(z)), v: pr.values.map((x: number | null) => (x == null ? null : conv ? conv(x) : x)), time: r.values?.[0]?.time ?? fr.time, method: r.values?.[0]?.method };
          if (!col.v.some((x: any) => x != null)) return null; (run.columns[p.key] ||= {})[k] = col; return col;
        };
        run[k] = await matchProfiles({ profiles: obs, frames: fs.frames, maxDtH: prof.maxDt, maxDepth: prof.maxDepth, column, unit, label: opt.label, modelLabel: `${md.provider_label} · ${md.dataset}`,
          onProgress: (d, n) => setProfRun(r => r && { ...r, progress: [d, n] }) });
        setProfRun({ ...run, progress: null });
      }
      setProfRun({ ...run, progress: null });
    } catch (e: any) { setProfRun({ ...run, progress: null, error: e.message }); setError(e.message); } finally { setProfBusy(false); }
  };
  // ---------------------------------------------------------------- interaction
  const obsLayersHit = () => [...obsL.current.values()].flatMap(l => l.pointLayers).concat(sm.current?.map.getLayer("os-diff") ? ["os-diff"] : []).filter(id => sm.current?.map.getLayer(id));
  const dsOfKey = (key: string) => obsLoaded.find(id => id.startsWith(key)) || key;
  live.current.click = (e: any) => {
    if (tool === "section") { setSecPts(p => [...p, [e.lngLat.lng, e.lngLat.lat]]); return; }
    if (tool === "region") return; const m = sm.current!.map, hit = m.queryRenderedFeatures(e.point, { layers: obsLayersHit() })[0];
    if (hit) {
      const pr: any = hit.properties;
      if (pr.cluster) { const src: any = m.getSource(hit.source); src.getClusterExpansionZoom(pr.cluster_id).then((z: number) => m.easeTo({ center: (hit.geometry as any).coordinates, zoom: z + 0.3 })); return; }
      const ds = hit.layer.id === "os-diff" ? fusion.obs! : dsOfKey(pr.ds); setInsp({ kind: "platform", ds, pid: String(pr.id) });
      for (const l of obsL.current.values()) l.select(null); obsL.current.get(ds)?.select((hit.geometry as any).coordinates); return;
    }
    if (isGrid && showModel) { if (cmpOk) runCompare(e.lngLat.lng, e.lngLat.lat); else runPoint(e.lngLat.lng, e.lngLat.lat); }
  };
  const runPoint = async (lng: number, lat: number) => {
    if (!model || !frame) return; const lon = ((lng + 180) % 360 + 360) % 360 - 180;
    setInsp({ kind: "point", data: { lon, lat, loading: true } });
    try {
      const z = depthAxis ? depth : null, own = (desc && scalar ? M.timesFor(desc, scalar.axis) : []).length > 1;
      const r = await A.pointQuery(frame.task, lon, lat, { time: frame.time, depth: z, series: own, profile: !!depthAxis && depthAxis.values.length > 1 });
      r.values = (r.values || []).map((v: any) => { const sp = specFor(v.kind, v.units); return { ...v, display: v.value == null ? null : sp.convert ? sp.convert(v.value) : v.value, unit: sp.unit || v.units, label: sp.label || v.label, decimals: sp.decimals }; });
      const get = (n?: string | null) => r.values.find((x: any) => x.name === n)?.value;
      r.derived = (desc?.vectors || []).flatMap((vec: any) => { if (vec.u) { const u = get(vec.u), v = get(vec.v); if (u == null || v == null) return [];
        const to = bearing(u, v), wind = vec.kind === "wind", d = wind ? (to + 180) % 360 : to; return [{ label: vec.label + i18nText("速度"), value: `${fmtN(Math.hypot(u, v), vec.kind === "current" ? 3 : 2)} m/s`, sub: `${wind ? i18nText("来自") : i18nText("去向")} ${fmtN(d, 0)}°（${compass(d)}）` }]; }
        if (vec.direction) { const d = get(vec.direction); return d == null ? [] : [{ label: i18nText("浪向"), value: i18nText("来自 {0}°（{1}）", fmtN(d, 0), compass(d)), sub: i18nText("传播去向 {0}°", fmtN((d + 180) % 360, 0)) }]; } return []; });
      let series: any = null;
      if (scalar) {
        if (own && r.series?.length) { const ss = scalar.vars.map(n => r.series.find((s: any) => s.name === n)); if (ss.every(Boolean)) series = [{ label: scalar.label, unit: scalar.spec.unit || scalar.units, t: ss[0].times.map(A.tms), v: ss[0].times.map((_: any, i: number) => { const x = ss.map((s: any) => s.values[i]); return x.some((y: any) => y == null) ? null : scalar.derived ? Math.hypot(x[0], x[1]) : scalar.spec.convert ? scalar.spec.convert(x[0]) : x[0]; }) }]; }
        else if ((frameSet?.frames.length || 0) > 1) { const fr = frameSet!.frames.slice(0, 40); const rs = await Promise.all(fr.map(f => A.pointQuery(f.task, lon, lat, { time: f.time, depth: z, vars: scalar.vars }).catch(() => null)));
          series = [{ label: scalar.label, unit: scalar.spec.unit || scalar.units, t: fr.map(f => A.tms(f.time)), v: rs.map(x => { const vs = scalar.vars.map(n => x?.values.find((y: any) => y.name === n)?.value); if (vs.some(y => y == null)) return null; return scalar.derived ? Math.hypot(vs[0], vs[1]) : scalar.spec.convert ? scalar.spec.convert(vs[0]) : vs[0]; }) }]; }
      }
      const prof = r.profiles?.find((x: any) => scalar && x.name === scalar.vars[0]) || r.profiles?.[0];
      const profile = prof ? (() => { const sp = specFor(prof.kind, prof.units); return { label: sp.label || prof.name, unit: sp.unit || prof.units, z: prof.depth, v: prof.values.map((x: number | null) => x == null ? null : sp.convert ? sp.convert(x) : x) }; })() : null;
      const near = await Promise.all(obsLoaded.map(id => A.obsNear(id, { lon, lat, radius_km: 150 }).then(x => ({ ds: id, label: summaries[id]?.dataset || id, platforms: x.platforms })).catch(() => ({ ds: id, label: id, platforms: [] }))));
      setInsp({ kind: "point", data: { lon, lat, data: r, time: frame.time, depth: z, series, profile, near } });
    } catch (e: any) { setInsp({ kind: "point", data: { lon, lat, error: e.message } }); }
  };
  // point comparison of A and B: values at their matched time/depth, native time series, vertical profiles
  const runCompare = async (lng: number, lat: number) => {
    if (!frame || !scalar || !bScalar || !bMatch) return; const lon = ((lng + 180) % 360 + 360) % 360 - 180, unit = scalar.spec.unit || scalar.units;
    const base = { lon, lat, unit, decimals: scalar.spec.decimals, aLabel: elSource?.label || model?.provider_label, bLabel: bSource?.label, blockers: cmpBlockers, dtH: bMatch.dtH };
    setInsp({ kind: "compare", data: { ...base, loading: true } });
    const pickVal = (r: any, sc: M.ScalarOpt) => { const vs = sc.vars.map(n => r?.values?.find((x: any) => x.name === n)); if (vs.some(x => x?.value == null)) return null;
      return sc.derived ? Math.hypot(vs[0].value, vs[1].value) : sc.spec.convert ? sc.spec.convert(vs[0].value) : vs[0].value; };
    const layered = !!depthAxis && depthAxis.values.length > 1 && !!bDepthAxis && bDepthAxis.values.length > 1 && !scalar.derived && !bScalar.derived;
    try {
      const zA = depthAxis ? depth : null;
      const [ra, rb]: any[] = await Promise.all([A.pointQuery(frame.task, lon, lat, { time: frame.time, depth: zA, vars: scalar.vars, profile: layered }), A.pointQuery(bMatch.frame.task, lon, lat, { time: bMatch.frame.time, depth: bMatch.depth, vars: bScalar.vars, profile: layered })]);
      const series = async (frames: A.Frame[], sc: M.ScalarOpt, z: number | null, label: string, color: string) => { const fr = frames.slice(0, 48);
        const rs = await Promise.all(fr.map(f => A.pointQuery(f.task, lon, lat, { time: f.time, depth: z, vars: sc.vars }).catch(() => null)));
        return { label, unit, color, points: fr.length < 12, t: fr.map(f => A.tms(f.time)), v: rs.map(r => pickVal(r, sc)) }; };
      const [sa, sb] = await Promise.all([series(frameSet?.frames || [frame], scalar, zA, `A · ${base.aLabel}`, CMP_A), series(bFrames?.fs.frames || [bMatch.frame], bScalar, bMatch.depth, `B · ${base.bLabel}`, CMP_B)]);
      const prof = (r: any, sc: M.ScalarOpt, label: string, color: string, dash: boolean) => { const p = r?.profiles?.find((x: any) => x.name === sc.vars[0]); if (!p) return null;
        return { label, color, dash, z: p.depth.map((z: number) => Math.abs(z)), v: p.values.map((x: number | null) => (x == null ? null : sc.spec.convert ? sc.spec.convert(x) : x)) }; };
      const profiles = layered ? [prof(ra, scalar, `A · ${base.aLabel}`, CMP_A, false), prof(rb, bScalar, `B · ${base.bLabel}`, CMP_B, true)].filter(Boolean) : null;
      setInsp({ kind: "compare", data: { ...base, a: { value: pickVal(ra, scalar), time: frame.time, depth: zA }, b: { value: pickVal(rb, bScalar), time: bMatch.frame.time, depth: bMatch.depth },
        series: sa.v.some(v => v != null) || sb.v.some(v => v != null) ? [sa, sb] : null, profiles: profiles && profiles.length ? profiles : null,
        method: i18nText("取值：两数据源各自网格上双线性插值（邻点缺测时取最近有效格点）；B 取与 A 最接近的时次{0}，不做时间插值。时间序列使用各自原生时次。", bMatch.depth != null ? i18nText("与深度层") : "") } });
    } catch (e: any) { setInsp({ kind: "compare", data: { ...base, error: e.message } }); }
  };
  const drag = useRef<any>(null);
  live.current.down = (e: any) => { if (tool !== "region") return; e.preventDefault(); drag.current = e.lngLat; sm.current!.map.dragPan.disable(); };
  live.current.up = async (e: any) => {
    const a = drag.current; if (!a) return; drag.current = null; const m = sm.current!.map; m.dragPan.enable(); setTool("inspect");
    const b = e.lngLat, box: [number, number, number, number] = [Math.min(a.lng, b.lng), Math.max(-89, Math.min(a.lat, b.lat)), Math.max(a.lng, b.lng), Math.min(89, Math.max(a.lat, b.lat))];
    if (box[2] - box[0] < 0.05 || box[3] - box[1] < 0.05) { setBox(null); return; }
    setInsp({ kind: "region", data: { bbox: box, loading: true } });
    const vars = scalar && scalarId !== "none" ? scalar.vars : vector?.u ? [vector.u, vector.v!] : null;
    const [r, near] = await Promise.all([isGrid && vars && frame ? A.regionQuery(frame.task, vars, box, { time: frame.time, depth: depthAxis ? depth : null, series: true }).catch(err => ({ error: err.message })) : null,
      Promise.all(obsLoaded.map(id => A.obsNear(id, { bbox: box.map(x => x.toFixed(3)).join(",") }).then(x => ({ ds: id, label: summaries[id]?.dataset || id, platforms: x.platforms, total: x.total })).catch(() => ({ ds: id, label: id, platforms: [], total: 0 }))))]);
    const conv = scalar?.spec.convert && !scalar.derived ? scalar.spec.convert : null;
    setInsp({ kind: "region", data: { bbox: box, data: r && !(r as any).error ? r : null, error: (r as any)?.error, near, unit: scalar ? scalar.spec.unit || scalar.units : "", conv } });
  };
  const setBox = (b: number[] | null) => { const m = sm.current?.map; if (!m) return; const data: any = { type: "FeatureCollection", features: b ? [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]] } }] : [] };
    const s = m.getSource("os-box") as any; if (s) s.setData(data); else { m.addSource("os-box", { type: "geojson", data }); m.addLayer({ id: "os-box-f", type: "fill", source: "os-box", paint: { "fill-color": "#38b6e6", "fill-opacity": 0.08 } }); m.addLayer({ id: "os-box-l", type: "line", source: "os-box", paint: { "line-color": "#38b6e6", "line-width": 1.6, "line-dasharray": [3, 2] } }); } };
  live.current.hover = (e: any) => {
    const el = hoverEl.current, m = sm.current?.map; if (!el || !m) return;
    if (drag.current) { const a = drag.current, b = e.lngLat; setBox([Math.min(a.lng, b.lng), Math.min(a.lat, b.lat), Math.max(a.lng, b.lng), Math.max(a.lat, b.lat)]); }
    const { lng, lat } = e.lngLat, L = ((lng + 180) % 360 + 360) % 360 - 180, parts: HNode[] = [h("span", undefined, `${Math.abs(lat).toFixed(2)}°${lat < 0 ? "S" : "N"} ${Math.abs(L).toFixed(2)}°${L < 0 ? "W" : "E"}`)];
    const f = freshF();
    const pick = (a?: A.Field | null, b?: A.Field | null) => { for (const c of [b, a]) if (c) { const s = A.sampler(c), gx = s.fx(lng), gy = s.fy(lat); if (gx >= 0 && gy >= 0) return { s, gx, gy }; } return null; };
    const val = (p: ReturnType<typeof pick>, sc: M.ScalarOpt) => { if (!p) return NaN; const raw = sc.derived ? Math.hypot(p.s.at(0, p.gx, p.gy), p.s.at(1, p.gx, p.gy)) : p.s.at(0, p.gx, p.gy); return sc.spec.convert && !sc.derived ? sc.spec.convert(raw) : raw; };
    if (showModel && scalar && scalarId !== "none") { const p = pick(f.s, f.sd); if (p) { const v = val(p, scalar), u = scalar.spec.unit || scalar.units;
      if (cmpOk && bScalar) { const w = val(pick(Fb.current.s, Fb.current.sd), bScalar);
        parts.push(h("em", undefined, h("i", "ab", "A"), h("b", undefined, fmtN(v, scalar.spec.decimals)), " ", h("i", "ab b", "B"), h("b", undefined, fmtN(w, scalar.spec.decimals)),
          ` ${u} · Δ ${Number.isFinite(v) && Number.isFinite(w) ? fmtN(v - w, scalar.spec.decimals) : "—"}`)); }
      else parts.push(h("em", undefined, h("b", undefined, fmtN(v, scalar.spec.decimals)), ` ${u}`)); } }
    if (cmpOk && cmp.view === "side") sideApi.current?.cross(e.lngLat);
    if (showModel && vector && vectorId !== "none" && f.v) { const p = pick(f.v); if (p) { const n = f.v.variables.map(x => x.name), u = p.s.at(n.indexOf(vector.u!), p.gx, p.gy), v = p.s.at(n.indexOf(vector.v!), p.gx, p.gy); if (u === u && v === v) { const to = bearing(u, v), d = flowKind === "wind" ? (to + 180) % 360 : to; parts.push(h("em", undefined, `${fmtN(Math.hypot(u, v), flowKind === "current" ? 2 : 1)} m/s · ${flowKind === "wind" ? i18nText("来自") : i18nText("去向")} ${fmtN(d, 0)}°`)); } } }
    const hit = m.queryRenderedFeatures(e.point, { layers: obsLayersHit() })[0];
    if (hit) { const pr: any = hit.properties; // feature properties come from observation files: text only
      parts.push(h("em", "obs", pr.cluster ? i18nText("{0} 个平台 · 点击展开", pr.point_count) : hit.layer.id === "os-diff" && pr.kind === "prof" ? i18nText("{0} · 剖面平均偏差 {1} · RMSE {2} · {3} 层", pr.id, fmtN(pr.d, 3), fmtN(pr.rmse, 3), pr.n) : hit.layer.id === "os-diff" ? i18nText("{0} · 观测 {1} · 模式 {2} · 差 {3}", pr.id, fmtN(pr.o, 2), fmtN(pr.mo, 2), fmtN(pr.d, 2)) : `${(TYPE_STYLE[pr.type] || TYPE_STYLE.unknown).label} ${pr.id}${pr.value != null && pr.value !== "null" ? " · " + fmtN(+pr.value, 2) : ""} · ${String(pr.time).slice(5, 16).replace("T", " ")}`)); }
    m.getCanvas().style.cursor = hit ? "pointer" : tool === "region" ? "crosshair" : "";
    renderHover(el, parts); el.style.opacity = "1";
  };
  // ---------------------------------------------------------------- vertical section (real levels of the current file)
  const runSection = async () => {
    const pts = secPts; setTool("inspect"); if (pts.length < 2) return;
    const daily = !!model && /P1D|daily|_day/i.test(model.dataset), source = model ? `${model.provider_label || model.provider} · ${model.dataset}` : "";
    if (!model || !frame || !scalar || scalarId === "none" || scalar.derived || !depthAxis || depthAxis.values.length < 2) {
      setInsp({ kind: "section", data: { points: pts, error: i18nText("当前颜色场没有多个真实深度层（或为派生速度），无法生成垂向断面。请选择带深度层的温度 / 盐度等变量。") } }); return; }
    setInsp({ kind: "section", data: { points: pts, loading: true } });
    try { const r = await sectionQuery(frame.task, scalar.vars, pts, frame.time); setInsp({ kind: "section", data: { points: pts, r, source, daily } }); }
    catch (e: any) { const m = e?.message || String(e);
      setInsp({ kind: "section", data: { points: pts, source, error: /not found|404/i.test(m) ? i18nText("服务端未提供断面接口（/section）。") : m } }); }
  };
  useEffect(() => { const m = sm.current?.map; if (!mapReady || !m) return;
    const line = insp?.kind === "section" ? insp.data.points : secPts;
    const data: any = { type: "FeatureCollection", features: line.length ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line } },
      ...line.map((p: number[]) => ({ type: "Feature", properties: { v: 1 }, geometry: { type: "Point", coordinates: p } }))] : [] };
    const src = m.getSource("os-section") as any;
    if (src) src.setData(data); else { m.addSource("os-section", { type: "geojson", data });
      m.addLayer({ id: "os-section-line", type: "line", source: "os-section", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#ffd166", "line-width": 2.2, "line-dasharray": [2, 1.2] } });
      m.addLayer({ id: "os-section-pts", type: "circle", source: "os-section", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 4, "circle-color": "#ffd166", "circle-stroke-color": "#0b1622", "circle-stroke-width": 1.5 } }); }
    for (const id of ["os-section-line", "os-section-pts"]) if (m.getLayer(id)) m.moveLayer(id);
    m.getCanvas().style.cursor = tool === "section" ? "crosshair" : "";
  }, [secPts, insp, mapReady, tool]);
  // ---------------------------------------------------------------- playback, prefetch, URL, keys
  const queriesFor = useCallback((fr: A.Frame) => {
    const out: Parameters<typeof A.loadField>[0][] = [], z = depthAxis ? depth : null;
    if (scalar && scalarId !== "none") out.push({ id: fr.task, vars: scalar.vars, time: fr.time, depth: z, bbox: null, maxCells: BASE_CELLS });
    if (vector && vectorId !== "none" && !flowSource && (!scalar || scalar.vars.join() !== M.vectorVars(vector).join())) out.push({ id: fr.task, vars: M.vectorVars(vector), time: fr.time, depth: z, bbox: null, maxCells: BASE_CELLS });
    return out;
  }, [scalar?.id, scalarId, vector?.id, vectorId, flowSource, depth, depthAxis]);
  const [cacheTick, setCacheTick] = useState(0);
  useEffect(() => {
    if (!frameSet || frameSet.frames.length < 2 || !showModel || frameOwner.current !== modelId || model?.id !== modelId) return; let stop = false;
    (async () => { const fr = frameSet.frames, order = playing ? fr.map((_, k) => fr[(nearIdx + 1 + k) % fr.length]) : [fr[(nearIdx + 1) % fr.length]];
      for (const f of order) { if (stop) break; for (const q of queriesFor(f)) await A.loadField(q).catch(() => null); if (!stop) setCacheTick(t => t + 1); } })();
    return () => { stop = true; };
  }, [frameSet, queriesFor, playing, playing ? 0 : nearIdx, showModel]);
  const cached = useMemo(() => (frameSet?.frames || []).map(f => queriesFor(f).every(q => !!A.peekField(q))), [frameSet, queriesFor, cacheTick, fieldsVersion]);
  const step1 = useCallback((dir: 1 | -1) => {
    if (step === "model" && frameTimes.length && showModel) { const i = nearIdx + dir; setCursor(frameTimes[(i + frameTimes.length) % frameTimes.length]); return; }
    const h = step === "model" ? 1 : step; setCursor(c => { let n = c + dir * h * 3.6e6; if (n > domain[1]) n = domain[0]; if (n < domain[0]) n = domain[1]; return n; });
  }, [step, frameTimes, nearIdx, domain, showModel]);
  useEffect(() => { if (!playing || loading) return; const t = window.setTimeout(() => step1(1), 1000 / fps); return () => clearTimeout(t); }, [playing, loading, fps, cursor, fieldsVersion, step1]);
  useEffect(() => {
    const p = new URLSearchParams(); p.set("lang", language); p.set("mode", mode); if (modelId) p.set("model", modelId); if (scalarId) p.set("var", scalarId); if (vectorId) p.set("vec", vectorId);
    if (obsSel.length) p.set("obs", obsSel.join(",")); if (Number.isFinite(cursor)) p.set("t", A.isoOf(cursor)); if (globe) p.set("view", "globe"); if (depth != null && depthAxis) p.set("z", String(depth));
    if (mode === "model" && browse === "element" && elementId) { p.set("el", elementId); if (srcProvider) p.set("src", srcProvider); if (cmp.on && cmp.provider) { p.set("cmp", cmp.provider); p.set("cv", cmp.view); } }
    else if (mode === "model" && browse === "file") p.set("browse", "file");
    history.replaceState(null, "", "?" + p.toString());
  }, [mode, modelId, scalarId, vectorId, obsSel.join(), Math.round(cursor / 6e5), globe, depth, browse, elementId, srcProvider, cmp.on, cmp.provider, cmp.view]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.target as HTMLElement)?.closest("input,select,textarea")) return;
      if (e.code === "Space") { e.preventDefault(); setPlaying(p => !p); } else if (e.key === "ArrowRight") step1(1); else if (e.key === "ArrowLeft") step1(-1);
      else if (e.key === "Escape") { if (about) setAbout(false); else if (present) setPresent(false); else { setInsp(null); setBox(null); setTool("inspect"); setSecPts([]); } }
      else if (e.key.toLowerCase() === "p") setPresent(x => !x); else if (e.key.toLowerCase() === "g") setGlobe(x => !x); else if (e.key.toLowerCase() === "f") toggleFull(); else if (e.key === "?") setAbout(x => !x); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [step1, present, about]);
  const toggleFull = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => { });
  const sideOn = cmpOk && cmp.view === "side";
  useEffect(() => { const t = setTimeout(() => sm.current?.map.resize(), 260); return () => clearTimeout(t); }, [present, leftOpen, !!insp, sideOn]);

  // ---------------------------------------------------------------- layout
  const switchMode = (m: Mode) => { setMode(m);
    // entering observations: jump to the latest observed time of the loaded datasets (never to an invented time)
    if (m === "obs") { const t = obsRanges.map(r => r[1]); if (t.length) { setCursor(Math.max(...t)); setWindowH(w => Math.max(w, 24)); setStep(s => (s === "model" ? 1 : s)); } } if (m !== "model" && !obsSel.length) { const o = datasets.filter(d => d.kind === "observations" && d.renderable).sort((a, b) => (b.observations?.records || 0) - (a.observations?.records || 0))[0]; if (o) setObsSel([o.id]); } if (m === "fusion" && match) setInsp({ kind: "match" }); };
  const lanes: Lane[] = obsLoaded.filter(id => summaries[id]?.time?.length).map((id, i) => { const s = summaries[id], h = s.histogram;
    return { key: id, label: s.dataset, color: OBS_COLORS[i % OBS_COLORS.length], t0: A.tms(s.time[0]), t1: A.tms(s.time[1]), hist: h ? { start: A.tms(h.start), step: h.step_s * 1000, counts: h.counts } : undefined }; });
  const modelCtx: ModelCtx = model && isGrid ? { id: model.id, label: `${model.provider_label} · ${model.dataset}`, provider: model.provider } : null;
  const flowSets = datasets.filter(d => d.kind === "grid" && d.renderable && d.summary?.vectors?.some(v => v.u));
  const bounds = sm.current?.map.getBounds();
  const unit = scalar ? scalar.spec.unit || scalar.units : "";
  const obsVarOf = (id: string) => features[id]?.variable || null;
  return <div className={"os-app" + (present ? " present" : "")} data-mode={mode}>
    <header className="os-top">
      <a className="os-brand" href={"/ocean-studio.html?lang=" + language} title="Ocean Studio"><svg viewBox="0 0 32 32" width="22" height="22" aria-hidden><defs><linearGradient id="osg" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#5fd0f0" /><stop offset="1" stopColor="#1b6fb0" /></linearGradient></defs><circle cx="16" cy="16" r="13" fill="none" stroke="url(#osg)" strokeWidth="2.2" /><path d="M5 18c4-3 7 3 11 0s7 3 11 0" fill="none" stroke="#5fd0f0" strokeWidth="2.2" strokeLinecap="round" /><path d="M7 12.5c3-2 6 2 9 0s6 2 9 0" fill="none" stroke="#5fd0f0" strokeOpacity=".5" strokeWidth="1.6" strokeLinecap="round" /></svg><b>Ocean Studio</b></a>
      <nav className="os-modes" role="tablist" aria-label={i18nText("工作模式")}>{([["model", i18nText("数值模式")], ["obs", i18nText("观测数据")], ["fusion", i18nText("融合分析")]] as [Mode, string][]).map(([k, l]) => <button key={k} role="tab" aria-selected={mode === k} className={mode === k ? "on" : ""} onClick={() => switchMode(k)}>{l}</button>)}</nav>
      <div className="os-context">
        {mode !== "obs" && model && <span className="chip" title={model.path}><i className="src" />{model.provider_label}<em>{model.dataset}</em></span>}
        {mode !== "obs" && scalar && scalarId !== "none" && <span className="chip">{scalar.label}<em>{unit}</em></span>}
        {mode !== "model" && obsLoaded.map(id => summaries[id] && <span key={id} className="chip obs">{summaries[id].dataset}<em>{(obsCounts[id] ?? 0).toLocaleString()} {" " + i18nText("点")}</em></span>)}
        {depthAxis && depth != null && <span className="chip">{i18nText("深度")}<em>{fmtN(depth, depth < 10 ? 1 : 0)} m</em></span>}
      </div>
      <div className="os-actions">
        <div className="os-language" role="group" aria-label={i18nText("Language / 语言")}><Languages size={13} aria-hidden="true" />
          <button lang="zh-CN" aria-pressed={language === "zh"} onClick={() => switchLanguage("zh")}>{i18nText("中文")}</button>
          <button lang="en" aria-pressed={language === "en"} onClick={() => switchLanguage("en")}>EN</button>
        </div>
        <a className="os-account" href="https://github.com/kang340" target="_blank" rel="noopener noreferrer" title="GitHub · @kang340" aria-label="GitHub · @kang340"><Github size={15} aria-hidden="true" /><span>@kang340</span></a>
        <div className="os-seg2"><button className={!globe ? "on" : ""} onClick={() => setGlobe(false)} title={i18nText("二维地图 (G)")}><MapIcon size={14} />2D</button><button className={globe ? "on" : ""} onClick={() => setGlobe(true)} title={i18nText("三维地球 (G)")}><Globe2 size={14} />3D</button></div>
        <button className={"icon" + (basemap === "satellite" ? " on" : "")} title={basemap === "satellite" ? i18nText("切换为矢量底图") : i18nText("卫星影像底图（在线 · NASA GIBS Blue Marble）")} onClick={() => setBasemap(b => (b === "vector" ? "satellite" : "vector"))}><Satellite size={15} /></button>
        <button className={"icon" + (tool === "section" ? " on" : "")} title={i18nText("垂向断面：在地图上点选折线")} aria-label={i18nText("垂向断面")} onClick={() => { setTool(t => (t === "section" ? "inspect" : "section")); setSecPts([]); }}><Spline size={15} /></button>
        <button className={"icon" + (tool === "region" ? " on" : "")} title={i18nText("框选区域分析")} onClick={() => { setTool(t => (t === "region" ? "inspect" : "region")); setBox(null); }}><BoxSelect size={15} /></button>
        <button className="icon" title={theme === "dark" ? i18nText("浅色主题") : i18nText("深色主题")} onClick={toggleTheme}>{theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}</button>
        <button className="icon" title={i18nText("演示模式 (P)")} onClick={() => setPresent(true)}><Presentation size={15} /></button>
        <button className="icon" title={i18nText("全屏 (F)")} onClick={toggleFull}><Maximize2 size={15} /></button>
        <span className="sep" />
        <button className="lnk" onClick={() => setAbout(true)} title={i18nText("项目说明、样例数据目录与数据来源 (?)")}><Info size={14} />{i18nText("关于 · 数据")}</button>
      </div>
    </header>
    <div className="os-body">
      <aside className={"os-dock" + (leftOpen ? "" : " closed")} aria-label={i18nText("数据与图层")}>
        {mode === "model" && <div className="os-browse" role="tablist" aria-label={i18nText("浏览方式")}>
          <button role="tab" aria-selected={browse === "element"} className={browse === "element" ? "on" : ""} onClick={() => { if (browse === "element") return; const e = elementOf(scalar?.kind); if (e) { elPick.current = `${e}|${model?.provider}|${pickTick}`; setElementId(e); setSrcProvider(model?.provider || null); } setBrowse("element"); }}>{i18nText("按要素")}</button>
          <button role="tab" aria-selected={browse === "file"} className={browse === "file" ? "on" : ""} onClick={() => { setBrowse("file"); setCmp(c => ({ ...c, on: false })); }}>{i18nText("按数据文件")}</button></div>}
        {byElement && element && <ElementPanel el={element} sources={elSources} provider={elSource?.provider || null} setProvider={pickSource} activeFile={model ? { name: model.dataset, path: model.path } : null} compare={cmp} setCompare={setCmp} status={cmpStatus} />}
        {byElement && !element && <div className="os-alert info">{i18nText("选择地图上方的要素开始浏览。")}</div>}
        {mode === "model" && !elEmpty && <ModelPanel hideDatasets={byElement} datasets={datasets} modelId={modelId} setModelId={id => { setModelId(id); fitted.current = ""; }} scalars={scalars} scalarId={scalarId} setScalarId={setScalarId} range={range} setRange={setRange}
          autoRange={() => { const f = freshF(), src = f.sd && f.s && f.sd.factor < f.s.factor ? f.sd : f.s, b = sm.current?.map.getBounds(); if (src && scalar) setRange(robustRange(displayArray(src, scalar.derived ? [0, 1] : 0, scalar.spec.convert, scalar.spec.unit), scalar.spec.symmetric, b ? { f: src, bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] } : undefined)); }}
          field={fieldUi} setField={setFieldUi} vectors={vecDs?.describe?.vectors || []} vectorId={vectorId} setVectorId={setVectorId} flowSource={flowSource} setFlowSource={setFlowSource} flowSets={flowSets}
          flow={flowUi} setFlow={setFlowUi} waveVec={waveVec} waves={waves} setWaves={setWaves} unit={unit} frameNote={frameSet ? `${frameSet.note}${frameSet.excluded.length ? i18nText("；{0} 个同类文件未纳入（时间缺口或预报时效不同）", frameSet.excluded.length) : ""}` : ""} />}
        {mode === "obs" && <ObsPanel datasets={datasets} selected={obsSel} toggle={id => { const adding = !obsSel.includes(id); setObsSel(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id])); if (adding) focusObs.current = id; }} summaries={summaries} ui={obsUi} setUi={setObsUi} counts={obsCounts} canUnify={!!scalar && scalarId !== "none"} />}
        {mode === "fusion" && <FusionPanel datasets={datasets} ui={fusion} setUi={u => { setFusion(u); if (u.obs && u.obs !== fusion.obs && !summaries[u.obs]) A.obsSummary(u.obs).then(s => setSummaries(m => ({ ...m, [u.obs!]: s }))); }} suggestions={suggestions} summaries={summaries} run={runFusion} busy={matchBusy} result={match} openResult={() => setInsp({ kind: "match" })}
          prof={prof} setProf={setProf} runProfiles={runProfiles} profBusy={profBusy} profResult={profRun?.T || profRun?.S ? { n: (profRun.T || profRun.S)!.stats.n, rmse: (profRun.T || profRun.S)!.stats.rmse, unit: (profRun.T || profRun.S)!.unit } : null} openProfiles={() => setInsp({ kind: "profiles" })} />}
        {catalogErr && <div className="os-alert danger">{catalogErr}</div>}
      </aside>
      <main className={"os-stage" + (globe ? " globe" : "") + (sideOn ? " cmp-side" : "") + (byElement && !present ? " with-elbar" : "")}>
        <div ref={mapEl} className="os-map" />
        {sideOn && <SideMap main={sm.current} theme={theme} globe={globe} fields={bFields} style={bStyle} ocean={ocean} label={bSource?.label || ""} unit={unit} decimals={scalar?.spec.decimals ?? 2} apiRef={sideApi}
          onHover={ll => { const x = crossEl.current, m = sm.current?.map; if (!x || !m) return; if (!ll) { x.style.opacity = "0"; return; } const p = m.project(ll); x.style.transform = `translate(${p.x}px,${p.y}px)`; x.style.opacity = "1"; }} />}
        {sideOn && <div ref={crossEl} className="os-cross main" />}
        {sideOn && <div className="os-sidelabel a"><i className="ab">A</i>{elSource?.label}</div>}
        {byElement && !present && <div className="os-elwrap"><ElementBar counts={elCounts} active={elementId} onPick={id => { setElementId(id); setInsp(i => (i?.kind === "compare" ? null : i)); }} />
          {element && <SourceSwitcher el={element} sources={elSources} provider={elSource?.provider || null} setProvider={pickSource} compare={cmp} setCompare={setCmp} />}
          {cmpActive && cmpBlockers.length > 0 && <div className="os-cmpwarn"><b>{i18nText("无法对比：")}</b>{cmpBlockers[0]}
            {commonTime != null && bMatch?.dtH != null && bMatch.dtH > cmp.maxDt ? <button className="os-cmpjump" onClick={jumpCommon}>{i18nText("跳到共同时次") + " "}{fmtTime(commonTime, "utc", false)}</button>
              : bMatch?.dtH != null && bMatch.dtH > cmp.maxDt ? <span className="os-cmpnone">{i18nText("两数据源本地文件没有 ±")}{cmp.maxDt} {" " + i18nText("h 内的共同时次")}</span> : null}</div>}</div>}
        {elEmpty && element && <NoLocalData el={element} />}
        {cmpOk && cmp.view === "swipe" && <SwipeHandle x={cmp.swipe} setX={x => setCmp(c => ({ ...c, swipe: x }))} aLabel={elSource?.label || ""} bLabel={bSource?.label || ""} />}
        <button className="os-dock-toggle" onClick={() => setLeftOpen(o => !o)} title={leftOpen ? i18nText("收起面板") : i18nText("展开面板")} aria-label={leftOpen ? i18nText("收起面板") : i18nText("展开面板")}>{leftOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}</button>
        {loading > 0 && <div className="os-progress" role="status" aria-label={i18nText("读取中")} />}
        {error && <div className="os-toast" role="alert" onClick={() => setError("")}>{error}<small>{i18nText("点击关闭")}</small></div>}
        {tool === "region" && <div className="os-hint">{i18nText("在地图上拖拽绘制分析区域 · Esc 取消")}</div>}
        {tool === "section" && <div className="os-hint">{i18nText("依次点击地图添加断面折点（已") + " "}{secPts.length} {" " + i18nText("个）")}<button disabled={secPts.length < 2} onClick={runSection}>{i18nText("生成断面")}</button><button onClick={() => { setTool("inspect"); setSecPts([]); }}>{i18nText("取消")}</button></div>}
        <div ref={hoverEl} className="os-hover" />
        <Legend mode={mode} scalar={showModel && scalarId !== "none" ? scalar : null} range={range} palette={palette} bands={fieldUi.bands} field={F.current.sd && F.current.s && F.current.sd.factor < F.current.s.factor ? F.current.sd : F.current.s || null}
          flow={showModel && vector && vectorId !== "none" ? { label: vector.label, kind: flowKind, particles: flowUi.particles, arrows: flowUi.arrows } : null} obs={mode !== "model" ? obsLoaded.filter(id => !(mode === "fusion" && match && id === fusion.obs)).map(id => ({ id, label: summaries[id]?.dataset || "", v: obsVarOf(id), stops: obsStops(id) })) : []}
          diff={profMap ? { lim: diffLim, unit: (profRun!.T || profRun!.S)!.unit, label: i18nText("剖面平均偏差（模式 − Argo）· {0}", profRun!.T ? i18nText("温度") : i18nText("盐度")), sub: i18nText("每个圆点为一条 Argo 剖面的平均偏差，点击查看该剖面") }
            : mode === "fusion" && match ? { lim: diffLim, unit: match.unit, label: match.obs_variable.label } : null} source={model}
          cmp={cmpOk ? { view: cmp.view, a: elSource?.label || "", b: bSource?.label || "", lim: diffLimCmp, unit, grid: cmpStatus?.grid || "" } : null} />
        {present && <div className="os-present-title"><b>{mode === "obs" ? i18nText("海洋观测") : scalar?.label || "Ocean Studio"}</b><span>{fmtTime(cursor, tz)}{mode !== "obs" && model ? " · " + model.provider_label : ""}</span><button onClick={() => setPresent(false)}>{i18nText("退出演示 Esc")}</button></div>}
        {!datasets.length && !catalogErr && <div className="os-empty"><LayersIcon size={28} /><h2>{i18nText("正在读取数据目录…")}</h2></div>}
        {datasets.length > 0 && !datasets.some(d => d.renderable) && <div className="os-empty"><h2>{i18nText("数据目录中没有可展示的文件")}</h2><p>{i18nText("把 NetCDF / GRIB2 模式数据或 ERDDAP CSV 观测文件放入数据目录，并在") + " "}<code>catalog.json</code> {" " + i18nText("中登记后刷新页面。")}</p><button className="os-primary" onClick={() => setAbout(true)}>{i18nText("查看数据目录说明")}</button></div>}
      </main>
      {insp && !present && <div className="os-right">
        {insp.kind === "platform" && <PlatformInspector ds={insp.ds} dsLabel={summaries[insp.ds]?.dataset || ""} pid={insp.pid} onClose={() => { setInsp(null); for (const l of obsL.current.values()) l.select(null); }} cursor={cursor} model={modelCtx}
          basket={basket} toggleBasket={(ds, pid) => setBasket(b => (b.some(x => x.ds === ds && x.pid === pid) ? b.filter(x => !(x.ds === ds && x.pid === pid)) : [...b, { ds, pid }].slice(-6)))} onShowTrack={setTrack} onSeek={t => { setPlaying(false); setCursor(t); }} tz={tz} />}
        {insp.kind === "match" && match && <MatchInspector r={match} title={i18nText("模式–观测对比")} onClose={() => setInsp(null)} onFly={(lon, lat, pid) => { sm.current?.map.easeTo({ center: [lon, lat], zoom: Math.max(5, sm.current.map.getZoom()), duration: 600 }); if (fusion.obs) setInsp({ kind: "platform", ds: fusion.obs, pid }); }} />}
        {insp.kind === "point" && <PointInspector data={insp.data} near={insp.data.near || []} onClose={() => setInsp(null)} onPlatform={(ds, pid) => setInsp({ kind: "platform", ds, pid })} tz={tz} scalarLabel={scalar?.label} depthAxis={!!depthAxis} />}
        {insp.kind === "compare" && <CompareInspector data={insp.data} onClose={() => setInsp(null)} tz={tz} />}
        {insp.kind === "profiles" && profRun && <ProfileMatchInspector run={profRun} onClose={() => setInsp(null)} tz={tz} onFly={(lon, lat) => sm.current?.map.easeTo({ center: [lon, lat], zoom: Math.max(4.5, sm.current.map.getZoom()), duration: 600 })} />}
        {insp.kind === "section" && <SectionInspector data={insp.data} onClose={() => { setInsp(null); setSecPts([]); }} />}
        {insp.kind === "region" && <RegionInspector data={insp.data} near={insp.data.near || []} onClose={() => { setInsp(null); setBox(null); }} onPlatform={(ds, pid) => setInsp({ kind: "platform", ds, pid })} tz={tz} />}
      </div>}
    </div>
    {about && <AboutDialog datasets={datasets} onClose={() => { setAbout(false); localStorage.setItem("ocean-studio-welcomed", "1"); }} onOpen={d => { setAbout(false); localStorage.setItem("ocean-studio-welcomed", "1"); if (d.kind === "observations") { switchMode("obs"); setObsSel(s => (s.includes(d.id) ? s : [...s, d.id])); } else { setMode("model"); setBrowse("file"); setModelId(d.id); fitted.current = ""; } }} />}
    <Timeline domain={domain} cursor={Number.isFinite(cursor) ? cursor : domain[0]} setCursor={setCursor} frames={showModel ? frameTimes : []} frameShown={showModel && nearIdx >= 0 ? frameTimes[nearIdx] : null} lanes={mode !== "model" ? lanes : []}
      windowH={windowH} setWindowH={setWindowH} playing={playing} setPlaying={setPlaying} stop={() => { setPlaying(false); setCursor(showModel && frameTimes.length ? frameTimes[0] : domain[0]); }}
      step={showModel && frameTimes.length ? step : step === "model" ? 1 : step} setStep={setStep} fps={fps} setFps={setFps} step1={step1} interp={interp} setInterp={setInterp} canInterp={!!pair && showModel} loading={loading > 0}
      cached={showModel ? cached : []} tz={tz} setTz={setTz} depth={showModel ? depthAxis : null} depthValue={depth} setDepth={pickDepth} compact={present} />
  </div>;
}

function Legend({ mode, scalar, range, palette, bands, field, flow, obs, diff, source, cmp }: { mode: Mode; scalar: M.ScalarOpt | null; range: [number, number] | null; palette: string; bands: number; field: A.Field | null;
  flow: { label: string; kind: string; particles: boolean; arrows: boolean } | null; obs: { id: string; label: string; v: A.ObsVar | null; stops: [number, string][] | null }[]; diff: { lim: number; unit: string; label: string; sub?: string } | null; source: A.VizDataset | null;
  cmp: { view: string; a: string; b: string; lim: number; unit: string; grid: string } | null }) {
  const unit = scalar ? scalar.spec.unit || scalar.units : "";
  let bar = gradientCss(palette);
  if (bands > 1) { const t = lut(palette, bands), s: string[] = []; for (let i = 0; i < bands; i++) { const q = Math.round((i + 0.5) / bands * 255) * 4; s.push(`rgb(${t[q]},${t[q + 1]},${t[q + 2]}) ${(i / bands * 100).toFixed(2)}% ${((i + 1) / bands * 100).toFixed(2)}%`); } bar = `linear-gradient(90deg,${s.join(",")})`; }
  const ticks = (lo: number, hi: number) => { const raw = (hi - lo) / 5, mag = 10 ** Math.floor(Math.log10(raw || 1)), f = raw / mag, st = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag, out: number[] = []; for (let v = Math.ceil(lo / st) * st; v <= hi + st * 1e-6; v += st) out.push(+v.toPrecision(10)); return { out, dec: Math.max(0, -Math.floor(Math.log10(st))) }; };
  const Bar = ({ lo, hi, css, u, title, sub }: { lo: number; hi: number; css: string; u: string; title: string; sub?: string }) => { const t = ticks(lo, hi);
    return <div className="lg-block"><div className="lg-t"><b>{title}</b><span>{u}</span></div><div className="lg-bar" style={{ background: css }} /><div className="lg-ticks">{t.out.map(v => <span key={v} style={{ left: `${(v - lo) / (hi - lo) * 100}%` }}>{v.toFixed(t.dec)}</span>)}</div>{sub && <small>{sub}</small>}</div>; };
  const blocks: React.ReactNode[] = [];
  if (cmp?.view === "diff") blocks.push(<Bar key="cd" lo={-cmp.lim} hi={cmp.lim} css={gradientCss("balance")} u={cmp.unit} title={i18nText("{0}差值 A − B", scalar?.label || "")} sub={`A ${cmp.a} − B ${cmp.b} · ${cmp.grid}`} />);
  else if (scalar && range && range[1] > range[0]) blocks.push(<Bar key="s" lo={range[0]} hi={range[1]} css={bar} u={unit} title={scalar.label}
    sub={cmp ? i18nText("A {0} 与 B {1} 使用同一色标", cmp.a, cmp.b) : field ? i18nText("{0} · 显示 {1}×{2}（块平均 {3}×）· GPU 双线性", source?.provider_label || "", field.nx, field.ny, field.factor) : undefined} />);
  if (flow) blocks.push(<div key="f" className="lg-flow"><i />{flow.label}{" "}{flow.particles ? i18nText("粒子流") : ""}{flow.particles && flow.arrows ? " + " : ""}{flow.arrows ? i18nText("箭头") : ""} {" " + i18nText("· 参考") + " "}{flow.kind === "wind" ? "10" : flow.kind === "current" ? "0.6" : "—"} m/s{flow.kind === "wind" ? i18nText(" · 风向按来向读数") : flow.kind === "current" ? i18nText(" · 流向按去向") : ""}</div>);
  for (const o of obs) { if (o.v && o.stops) blocks.push(<Bar key={o.id} lo={o.stops[0][0]} hi={o.stops[o.stops.length - 1][0]} css={`linear-gradient(90deg,${o.stops.map((s, i) => `${s[1]} ${(i / (o.stops!.length - 1) * 100).toFixed(1)}%`).join(",")})`} u={o.v.display_unit} title={i18nText("实测 · {0}", o.v.label)} sub={i18nText("{0} · 圆点＝观测（外圈：橙 可疑 / 红 错误）", o.label)} />); }
  if (mode !== "model" && obs.some(o => !o.v)) blocks.push(<div key="types" className="lg-types">{Object.entries(TYPE_STYLE).slice(0, 8).map(([k, v]) => <span key={k}><i style={{ background: v.color }} />{v.label}</span>)}</div>);
  if (diff) blocks.push(<Bar key="d" lo={-diff.lim} hi={diff.lim} css="linear-gradient(90deg,#2166ac,#67a9cf,#f7f7f7,#ef8a62,#b2182b)" u={diff.unit} title={i18nText("模式 − 观测 · {0}", diff.label)} sub={diff.sub || i18nText("仅显示当前时间窗内的配对；白圈为离群配对")} />);
  if (!blocks.length) return null;
  return <div className="os-legend">{blocks}</div>;
}

class StudioBoundary extends Component<{ children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: any) { return { err: e?.message || String(e) }; }
  componentDidCatch(e: any) { console.error("Ocean Studio crashed", e); }
  render() { return this.state.err ? <div className="os-crash" role="alert" style={{ padding: 32, color: "var(--text, #c9d8e6)" }}><b>{i18nText("Ocean Studio 出现错误")}</b><p>{this.state.err}</p><button onClick={() => location.reload()}>{i18nText("重新加载")}</button></div> : this.props.children; }
}
createRoot(document.getElementById("root")!).render(<StudioBoundary><StudioApp /></StudioBoundary>);
/** Colour limit for profile-mean bias dots: twice the 5–95 % spread, symmetric. */
function profLim(r: ProfileRun) { const b = (r.T || r.S)!.profiles.filter(p => p.n > 0).map(p => p.bias).sort((x, y) => x - y);
  return Math.max(1e-6, 2 * (b.length ? Math.max(Math.abs(b[Math.floor(b.length * 0.05)]), Math.abs(b[Math.ceil(b.length * 0.95) - 1])) : 1)); }
const defaultObsVar = (s: A.ObsSummary) => (s.variables.find(v => v.kind === "sea_temperature" && v.valid) || s.variables.find(v => v.valid && v.kind !== "generic") || s.variables.find(v => v.valid))?.name ?? null;
