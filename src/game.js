(() => {
'use strict';
// ------------------------------------------------------------------ data
const M = MAP_DATA;
const [LAT0, LON0] = M.origin, [KX, KY] = M.k;
const proj = (lat, lon) => [(lon - LON0) * KX, (LAT0 - lat) * KY];
const unproj = (x, y) => [LAT0 - y / KY, x / KX + LON0];
const [BX0, BY0, BX1, BY1] = M.bounds;
const WALK = 72;            // meters per game minute (family pace, ~4.3 km/h)
const STAIRS = 1.5;         // minutes from street to platform
const DIST = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

const NN = M.nodes.length / 2;
const NX = new Float32Array(NN), NY = new Float32Array(NN);
for (let i = 0; i < NN; i++) { NX[i] = M.nodes[2 * i]; NY[i] = M.nodes[2 * i + 1]; }
const adj = Array.from({ length: NN }, () => []);
const edgeName = new Map(), ekey = (a, b) => (a < b ? a * NN + b : b * NN + a);
const ways = M.ways.map(([c, n, p]) => {
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i]; if (a === b) continue;
    const d = DIST(NX[a], NY[a], NX[b], NY[b]);
    adj[a].push(b, d); adj[b].push(a, d); if (M.names[n]) edgeName.set(ekey(a, b), M.names[n]);
  }
  return { c, name: M.names[n], p };
});
// keep only the largest connected street network for walking
const comp = new Int32Array(NN).fill(-1);
let bestComp = 0, bestSize = 0;
for (let s = 0, cid = 0; s < NN; s++) {
  if (comp[s] >= 0) continue;
  let size = 0; const st = [s]; comp[s] = cid;
  while (st.length) { const u = st.pop(); size++; const a = adj[u]; for (let k = 0; k < a.length; k += 2) { const v = a[k]; if (comp[v] < 0) { comp[v] = cid; st.push(v); } } }
  if (size > bestSize) { bestSize = size; bestComp = cid; }
  cid++;
}
const walkable = i => comp[i] === bestComp;
function nearestNode(x, y) {
  let best = -1, bd = Infinity;
  for (let i = 0; i < NN; i++) { if (!walkable(i)) continue; const d = (NX[i] - x) ** 2 + (NY[i] - y) ** 2; if (d < bd) { bd = d; best = i; } }
  return best;
}
const inMap = (x, y) => x > BX0 + 60 && x < BX1 - 60 && y > BY0 + 60 && y < BY1 - 60;

// places
const PL = {};
for (const p of PLACES) { const [x, y] = proj(p.lat, p.lon); p.x = x; p.y = y; p.onMap = inMap(x, y); p.node = p.onMap ? nearestNode(x, y) : -1; PL[p.id] = p; }
const CATCOLOR = { home: '#e9764b', friend: '#d9a52b', film: '#d9a52b', sight: '#3b78c9', museum: '#8a5cc7', market: '#2f936a' };

// stations and lines
const ST = {};
for (const [name, [x, y]] of Object.entries(M.stations)) ST[name] = { name, x, y, lines: [], onMap: inMap(x, y), node: -1 };
for (const s of Object.values(ST)) if (s.onMap) s.node = nearestNode(s.x, s.y);
const LINES = M.lines.map(l => ({ ...l, kind: l.ref[0] }));
for (const l of LINES) l.stops.forEach((n, i) => { if (!ST[n].lines.some(e => e.line === l)) ST[n].lines.push({ line: l, i }); });
const stKinds = s => { const k = new Set(s.lines.map(e => e.line.kind)); return [...k].sort().reverse(); }; // ['U','S'] order
function segMinutes(l, a, b) { const A = ST[l.stops[a]], B = ST[l.stops[b]]; const d = DIST(A.x, A.y, B.x, B.y); return 0.7 + d / (l.kind === 'U' ? 520 : 700); }
const WAIT = l => (l.kind === 'U' ? 3 : 4);
// segments shared by several lines get side-by-side offsets
const segLines = new Map();
for (const l of LINES) for (let i = 1; i < l.stops.length; i++) {
  const k = [l.stops[i - 1], l.stops[i]].sort().join('|');
  if (!segLines.has(k)) segLines.set(k, []);
  const arr = segLines.get(k); if (!arr.includes(l.ref)) arr.push(l.ref);
}
const sceneByStation = {};
for (const p of PLACES) if (p.scene) sceneByStation[p.scene.station] = p;

// ------------------------------------------------------------------ routing
// combined graph: street nodes | stations | line stops
const STN = Object.keys(ST), stIndex = {}; STN.forEach((n, i) => stIndex[n] = NN + i);
const lsBase = []; let G = NN + STN.length;
for (const l of LINES) { lsBase.push(G); G += l.stops.length; }
const gadj = Array.from({ length: G }, () => []);
const gedge = (a, b, w, tag) => gadj[a].push(b, w, tag);
for (let u = 0; u < NN; u++) { const a = adj[u]; for (let k = 0; k < a.length; k += 2) gedge(u, a[k], a[k + 1] / WALK, 0); }
STN.forEach(n => { const s = ST[n], si = stIndex[n]; if (s.node >= 0) { gedge(s.node, si, STAIRS, 1); gedge(si, s.node, STAIRS, 1); } });
LINES.forEach((l, li) => l.stops.forEach((n, i) => {
  const g = lsBase[li] + i, si = stIndex[n];
  gedge(si, g, WAIT(l), 2); gedge(g, si, 1.5, 3); // 1.5 min to get off and find the way on
  if (i > 0) { const t = segMinutes(l, i - 1, i); gedge(g, g - 1, t, 4); gedge(g - 1, g, t, 4); }
}));
class Heap { constructor() { this.a = []; } push(k, v) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; } get size() { return this.a.length; } }
function dijkstra(src, walkOnly) {
  const n = walkOnly ? NN : G, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), h = new Heap();
  dist[src] = 0; h.push(0, src);
  while (h.size) { const [d, u] = h.pop(); if (d > dist[u]) continue; const a = walkOnly ? adj[u] : gadj[u], step = walkOnly ? 2 : 3;
    for (let k = 0; k < a.length; k += step) { const v = a[k]; if (v >= n) continue; const nd = d + (walkOnly ? a[k + 1] / WALK : a[k + 1]); if (nd < dist[v]) { dist[v] = nd; prev[v] = u; h.push(nd, v); } } }
  return { dist, prev };
}
function walkPath(a, b) {
  if (a === b) return [a];
  // A* on the street graph
  const g = new Float64Array(NN).fill(Infinity), prev = new Int32Array(NN).fill(-1), h = new Heap();
  g[a] = 0; h.push(0, a);
  while (h.size) { const [, u] = h.pop(); if (u === b) break; const ad = adj[u];
    for (let k = 0; k < ad.length; k += 2) { const v = ad[k], nd = g[u] + ad[k + 1]; if (nd < g[v]) { g[v] = nd; prev[v] = u; h.push(nd + DIST(NX[v], NY[v], NX[b], NY[b]), v); } } }
  if (prev[b] < 0) return null;
  const out = [b]; let u = b; while (u !== a) { u = prev[u]; out.push(u); } return out.reverse();
}
// where the player is, as a graph node
function playerGraphNode() {
  if (P.at.kind === 'station') return stIndex[P.at.st];
  return P.at.node;
}
function placeTarget(p) { return p.onMap ? p.node : stIndex[p.scene.station]; }
function placeExtra(p) { return p.onMap ? 0 : p.scene.walk; }
// best plan (minutes + steps) visiting all remaining goals, any order
function bestPlan(fromNode, goals) {
  if (!goals.length) return { mins: 0, legs: [] };
  const perms = goals.length <= 1 ? [goals] : permute(goals);
  const cache = {};
  const run = src => cache[src] || (cache[src] = dijkstra(src, false));
  let best = null;
  for (const order of perms) {
    let src = fromNode, total = 0, legs = [];
    for (const id of order) { const p = PL[id], t = placeTarget(p), r = run(src); total += r.dist[t] + placeExtra(p); legs.push({ src, t, r, p }); src = t; }
    if (!best || total < best.mins) best = { mins: total, legs };
  }
  return best;
}
function permute(a) { if (a.length <= 1) return [a]; const out = []; a.forEach((x, i) => permute([...a.slice(0, i), ...a.slice(i + 1)]).forEach(r => out.push([x, ...r]))); return out; }
function lineFromG(g) { for (let li = LINES.length - 1; li >= 0; li--) if (g >= lsBase[li]) return { li, i: g - lsBase[li] }; return null; }
// turn a route into readable steps and a drawable polyline
function describeLeg(leg) {
  const { src, t, r } = leg; const nodes = [t]; let u = t; while (u !== src && u >= 0) { u = r.prev[u]; nodes.push(u); } nodes.reverse();
  const steps = []; const poly = []; let walkM = 0, ride = null;
  const flushWalk = () => { if (walkM > 0.6) steps.push({ kind: 'walk', mins: walkM }); walkM = 0; };
  for (let k = 0; k < nodes.length; k++) {
    const n = nodes[k], nx = nodes[k + 1];
    if (n < NN) poly.push([NX[n], NY[n], 'w']);
    else if (n < NN + STN.length) { const s = ST[STN[n - NN]]; poly.push([s.x, s.y, 's']); }
    else { const { li, i } = lineFromG(n); const l = LINES[li], s = ST[l.stops[i]]; poly.push([s.x, s.y, l.color]);
      if (nx !== undefined && nx >= NN + STN.length) { const o = lineFromG(nx); if (o.li === li) { if (!ride) { flushWalk(); ride = { kind: 'ride', line: l, from: l.stops[i], dir: o.i > i ? 1 : -1, stops: 0 }; } ride.stops++; ride.to = l.stops[o.i]; } }
      else if (ride) { steps.push(ride); ride = null; } }
    if (nx !== undefined && n < NN && nx < NN) walkM += DIST(NX[n], NY[n], NX[nx], NY[nx]) / WALK;
  }
  flushWalk(); if (ride) steps.push(ride);
  return { steps, poly };
}
const lineTerm = (l, dir) => (dir > 0 ? l.to : l.from);

// ------------------------------------------------------------------ state
const SAVE_KEY = 'berlin-unterwegs-v1';
let save = { stars: {}, found: {}, words: {} };
try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (s) save = Object.assign(save, s); } catch (e) {}
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} };

const P = { straight: 0, street: null, x: 0, y: 0, at: { kind: 'street', node: 0 }, path: null, pathI: 0, pathT: 0, onArrive: null, train: null };
const S = { mode: 'title', day: 1, min: 600, temp: 4, rain: false, warmth: 100, mission: null, visited: new Set(), started: 0, paused: 0, hint: null, hintUsed: false, real: null, sheetFor: null };

// ------------------------------------------------------------------ canvas + view
const cv = document.getElementById('map'), ctx = cv.getContext('2d');
let DPR = Math.min(window.devicePixelRatio || 1, 2), W = 0, H = 0;
const V = { x: 0, y: 0, s: 0.35, follow: true };
function resize() { W = cv.clientWidth; H = cv.clientHeight; cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR); labelsDirty = true; draw(); }
const toScreen = (x, y) => [(x - V.x) * V.s + W / 2, (y - V.y) * V.s + H / 2];
const toWorld = (sx, sy) => [(sx - W / 2) / V.s + V.x, (sy - H / 2) / V.s + V.y];
const clampScale = s => Math.max(0.025, Math.min(4, s));

// cached world-space paths
const paths = { street: [new Path2D(), new Path2D(), new Path2D(), new Path2D(), new Path2D(), new Path2D()], park: new Path2D(), water: new Path2D(), river: new Path2D() };
for (const w of ways) { const pth = paths.street[w.c]; w.p.forEach((n, i) => i ? pth.lineTo(NX[n], NY[n]) : pth.moveTo(NX[n], NY[n])); }
const ring = (pth, r) => { for (let i = 0; i < r.length; i += 2) i ? pth.lineTo(r[i], r[i + 1]) : pth.moveTo(r[i], r[i + 1]); pth.closePath(); };
for (const r of M.parks) ring(paths.park, r);
for (const r of M.water) ring(paths.water, r);
for (const [, r] of M.rivers) for (let i = 0; i < r.length; i += 2) i ? paths.river.lineTo(r[i], r[i + 1]) : paths.river.moveTo(r[i], r[i + 1]);

// label candidates: longest straight piece of each named street
const labelCands = [];
{ const seen = new Map();
  for (const w of ways) { if (!w.name || w.c === 5) continue; let best = 0, bi = -1;
    for (let i = 1; i < w.p.length; i++) { const a = w.p[i - 1], b = w.p[i], d = DIST(NX[a], NY[a], NX[b], NY[b]); if (d > best) { best = d; bi = i; } }
    if (bi < 0 || best < 60) continue; const a = w.p[bi - 1], b = w.p[bi];
    let ang = Math.atan2(NY[b] - NY[a], NX[b] - NX[a]); if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
    labelCands.push({ name: w.name, c: w.c, x: (NX[a] + NX[b]) / 2, y: (NY[a] + NY[b]) / 2, len: best, ang }); }
  labelCands.sort((a, b) => a.c - b.c || b.len - a.len); void seen; }
let labels = [], labelsDirty = true;
function layoutLabels() {
  labels = []; if (V.s < 0.5) return;
  ctx.font = `600 ${12}px ${getComputedStyle(document.body).getPropertyValue('--display')}`;
  const byName = new Map(), boxes = [];
  for (const L of labelCands) {
    if (L.c >= 4 && V.s < 0.9) continue;
    const [sx, sy] = toScreen(L.x, L.y); if (sx < -40 || sy < -40 || sx > W + 40 || sy > H + 40) continue;
    const tw = ctx.measureText(L.name).width; if (L.len * V.s < tw + 12) continue;
    const prevs = byName.get(L.name) || []; if (prevs.some(([px, py]) => Math.hypot(px - sx, py - sy) < 260)) continue;
    const r = Math.max(tw, 14) / 2 + 4; if (boxes.some(([bx, by, br]) => Math.hypot(bx - sx, by - sy) < br + r)) continue;
    boxes.push([sx, sy, r]); prevs.push([sx, sy]); byName.set(L.name, prevs); labels.push({ ...L, tw });
    if (labels.length > 140) break;
  }
  labelsDirty = false;
}

// day / night colors
const DAYC = { ground: [221, 226, 230], minor: [250, 251, 252], major: [255, 244, 214], park: [196, 214, 190], water: [150, 182, 206], label: [70, 78, 92], halo: [235, 238, 241] };
const NIGHTC = { ground: [27, 34, 49], minor: [55, 64, 84], major: [104, 92, 64], park: [30, 46, 39], water: [16, 30, 50], label: [196, 204, 218], halo: [24, 30, 44] };
const mix = (a, b, t) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;
function darkness() { const d = DAYS[S.day] || DAYS[1], m = ((S.min % 1440) + 1440) % 1440;
  const sm = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  return Math.max(sm(d.set - 25, d.set + 45, m), 1 - sm(d.rise - 45, d.rise + 25, m)); }
const isDark = () => darkness() > 0.5;
const marketOpen = p => S.day >= 1 && (S.min % 1440) >= p.opens * 60 && (S.min % 1440) < 22 * 60;
const museumOpen = () => (S.min % 1440) >= 10 * 60 && (S.min % 1440) < 18 * 60;

// rain particles
const drops = Array.from({ length: 110 }, () => ({ x: Math.random(), y: Math.random(), v: 0.6 + Math.random() * 0.6 }));
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function draw() {
  if (!W) return;
  const dk = darkness(), C = k => mix(DAYC[k], NIGHTC[k], dk);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = mix([200, 206, 212], [18, 23, 34], dk); ctx.fillRect(0, 0, W, H);
  ctx.setTransform(V.s * DPR, 0, 0, V.s * DPR, (W / 2 - V.x * V.s) * DPR, (H / 2 - V.y * V.s) * DPR);
  ctx.fillStyle = C('ground'); ctx.fillRect(BX0, BY0, BX1 - BX0, BY1 - BY0);
  ctx.fillStyle = C('park'); ctx.fill(paths.park, 'evenodd');
  ctx.fillStyle = C('water'); ctx.fill(paths.water, 'evenodd');
  ctx.strokeStyle = C('water'); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(14, 3 / V.s); ctx.stroke(paths.river);
  const px = 1 / V.s, sw = [16, 13, 11, 9, 6, 5];
  for (let c = 5; c >= 0; c--) { if (c >= 4 && V.s < 0.12) continue;
    ctx.strokeStyle = c <= 3 ? C('major') : C('minor'); if (c === 5) ctx.strokeStyle = mix([238, 232, 222], [70, 70, 80], dk);
    ctx.lineWidth = Math.max(sw[c], (c <= 3 ? 1.6 : 0.9) * px); ctx.stroke(paths.street[c]); }
  // map edge
  ctx.strokeStyle = mix([150, 158, 170], [60, 70, 92], dk); ctx.setLineDash([8 * px, 6 * px]); ctx.lineWidth = 1.5 * px; ctx.strokeRect(BX0, BY0, BX1 - BX0, BY1 - BY0); ctx.setLineDash([]);
  // market glow after dark
  if (dk > 0.15) for (const p of PLACES) if (p.cat === 'market' && marketOpen(p)) {
    const r = Math.max(110, 34 * px), g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    g.addColorStop(0, `rgba(255,190,90,${0.55 * dk})`); g.addColorStop(1, 'rgba(255,190,90,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill(); }
  // transit lines
  ctx.globalAlpha = V.s < 0.2 ? 0.95 : 0.75;
  const lw = Math.max(3.2 * px, V.s > 1 ? 9 : 0);
  for (const l of LINES) { ctx.strokeStyle = l.color; ctx.lineWidth = lw;
    for (let i = 1; i < l.stops.length; i++) { const A = ST[l.stops[i - 1]], B = ST[l.stops[i]];
      const arr = segLines.get([A.name, B.name].sort().join('|')), k = arr.indexOf(l.ref) - (arr.length - 1) / 2;
      let nx = -(B.y - A.y), ny = B.x - A.x; const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L; const sgn = A.name < B.name ? 1 : -1; const o = k * lw * 1.05 * sgn;
      ctx.beginPath(); ctx.moveTo(A.x + nx * o, A.y + ny * o); ctx.lineTo(B.x + nx * o, B.y + ny * o); ctx.stroke(); } }
  ctx.globalAlpha = 1;
  // hint route
  if (S.hint) { ctx.lineWidth = 5 * px; ctx.setLineDash([2 * px, 9 * px]); ctx.strokeStyle = '#f3c22f';
    for (const poly of S.hint) { ctx.beginPath(); poly.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); } ctx.setLineDash([]); }
  // walking path
  if (P.path) { ctx.strokeStyle = 'rgba(243,194,47,.9)'; ctx.lineWidth = 4 * px; ctx.beginPath(); ctx.moveTo(P.x, P.y);
    for (let i = P.pathI + 1; i < P.path.length; i++) ctx.lineTo(NX[P.path[i]], NY[P.path[i]]); ctx.stroke(); }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  // street labels
  if (labelsDirty) layoutLabels();
  if (labels.length) { const font = getComputedStyle(document.body).getPropertyValue('--display');
    ctx.font = `600 12px ${font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (const L of labels) { const [sx, sy] = toScreen(L.x, L.y); ctx.save(); ctx.translate(sx, sy); ctx.rotate(L.ang);
      ctx.lineWidth = 3; ctx.strokeStyle = C('halo'); ctx.strokeText(L.name, 0, 0); ctx.fillStyle = C('label'); ctx.fillText(L.name, 0, 0); ctx.restore(); } }
  drawStations(dk); drawPlaces(); drawPlayer(); drawReal();
  if (S.rain && S.mode === 'play') drawRain(dk);
}
function drawStations(dk) {
  const font = getComputedStyle(document.body).getPropertyValue('--display');
  const show = V.s > 0.16, named = V.s > 0.42;
  for (const s of Object.values(ST)) {
    if (!s.onMap && V.s < 0.05) continue;
    const [sx, sy] = toScreen(s.x, s.y); if (sx < -30 || sy < -30 || sx > W + 30 || sy > H + 30) continue;
    if (!show) { ctx.fillStyle = '#fff'; ctx.strokeStyle = '#333'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(sx, sy, 2.6, 0, 7); ctx.fill(); ctx.stroke(); continue; }
    const kinds = stKinds(s), sz = V.s > 0.9 ? 15 : 12; let x = sx - (kinds.length - 1) * (sz / 2 + 1);
    for (const k of kinds) { ctx.fillStyle = k === 'U' ? '#1f5fae' : '#3a8a3c'; ctx.beginPath();
      if (k === 'U') ctx.roundRect(x - sz / 2, sy - sz / 2, sz, sz, 2); else ctx.arc(x, sy, sz / 2, 0, 7); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = `700 ${sz - 2}px ${font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(k, x, sy + 0.5); x += sz + 2; }
    if (named) { ctx.font = `600 13px ${font}`; ctx.textAlign = 'left'; ctx.lineWidth = 3.2; ctx.lineJoin = 'round';
      const tx = sx + (kinds.length * (sz + 2)) / 2 + 3; ctx.strokeStyle = mix(DAYC.halo, NIGHTC.halo, dk); ctx.strokeText(s.name, tx, sy);
      ctx.fillStyle = dk > .5 ? '#e7ecf5' : '#1d2a44'; ctx.fillText(s.name, tx, sy); }
  }
}
function drawPlaces() {
  const font = getComputedStyle(document.body).getPropertyValue('--display');
  const goals = S.mission ? new Set(S.mission.goal) : new Set();
  const small = V.s < 0.14;
  for (const p of PLACES) {
    const [sx, sy] = toScreen(p.x, p.y); if (sx < -30 || sy < -30 || sx > W + 30 || sy > H + 30) continue;
    const r = small ? 6 : 11, isGoal = goals.has(p.id) && !S.visited.has(p.id);
    if (isGoal) { const t = performance.now() / 600; ctx.strokeStyle = '#f3c22f'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(sx, sy, r + 5 + (reduceMotion ? 0 : Math.sin(t) * 2), 0, 7); ctx.stroke(); }
    ctx.fillStyle = CATCOLOR[p.cat]; ctx.beginPath(); ctx.arc(sx, sy, r, 0, 7); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    if (!small) { ctx.fillStyle = '#fff'; ctx.font = `700 ${p.id.length > 1 ? 12 : 13}px ${font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(p.id, sx, sy + 0.5); }
    if (save.found[p.id] && !small) { ctx.fillStyle = '#69c07a'; ctx.beginPath(); ctx.arc(sx + r * .8, sy - r * .8, 4.5, 0, 7); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
    if (V.s > 0.7 || (isGoal && V.s > 0.25)) { ctx.font = `600 13px ${font}`; ctx.textAlign = 'center'; ctx.lineWidth = 3.2; ctx.strokeStyle = 'rgba(20,26,40,.85)'; ctx.strokeText(p.name, sx, sy + r + 11); ctx.fillStyle = '#fff'; ctx.fillText(p.name, sx, sy + r + 11); }
  }
}
function drawPlayer() {
  if (S.mode !== 'play') return;
  const [sx, sy] = toScreen(P.x, P.y);
  if (P.train) { const l = P.train.line; ctx.fillStyle = l.kind === 'U' ? '#f3c22f' : '#c23a2b'; ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(sx - 15, sy - 8, 30, 16, 5); ctx.fill(); ctx.stroke(); ctx.fillStyle = l.color; ctx.fillRect(sx - 11, sy - 2, 22, 4); return; }
  ctx.fillStyle = 'rgba(243,194,47,.25)'; ctx.beginPath(); ctx.arc(sx, sy, 20, 0, 7); ctx.fill();
  ctx.fillStyle = '#f3c22f'; ctx.strokeStyle = '#151c2a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(sx, sy, 9, 0, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#c0392b'; ctx.fillRect(sx - 6, sy + 1, 12, 3); // scarf
}
function drawReal() {
  if (!S.real || !S.real.pos) return;
  const [x, y] = S.real.pos, [sx, sy] = toScreen(x, y), acc = Math.max(8, S.real.acc * V.s);
  ctx.fillStyle = 'rgba(66,133,244,.18)'; ctx.beginPath(); ctx.arc(sx, sy, acc, 0, 7); ctx.fill();
  ctx.fillStyle = '#4285f4'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(sx, sy, 8, 0, 7); ctx.fill(); ctx.stroke();
}
function drawRain(dk) {
  ctx.strokeStyle = dk > .5 ? 'rgba(170,190,220,.35)' : 'rgba(90,110,140,.35)'; ctx.lineWidth = 1; ctx.beginPath();
  for (const d of drops) { const x = d.x * W, y = d.y * H; ctx.moveTo(x, y); ctx.lineTo(x - 3, y + 11); } ctx.stroke();
}

// ------------------------------------------------------------------ input: pan, pinch, tap
const ptrs = new Map(); let gesture = null;
cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.offsetX, e.offsetY]);
  if (ptrs.size === 1) gesture = { kind: 'maybe', sx: e.offsetX, sy: e.offsetY, t: performance.now(), vx: V.x, vy: V.y };
  else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; gesture = { kind: 'pinch', d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: V.s, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], vx: V.x, vy: V.y }; } });
cv.addEventListener('pointermove', e => { if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, [e.offsetX, e.offsetY]);
  if (!gesture) return;
  if (gesture.kind === 'pinch' && ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const ns = clampScale(gesture.s * d / gesture.d); const [wx, wy] = [(gesture.mid[0] - W / 2) / gesture.s + gesture.vx, (gesture.mid[1] - H / 2) / gesture.s + gesture.vy];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; V.s = ns; V.x = wx - (mid[0] - W / 2) / ns; V.y = wy - (mid[1] - H / 2) / ns; V.follow = false; labelsDirty = true; draw(); return; }
  const dx = e.offsetX - gesture.sx, dy = e.offsetY - gesture.sy;
  if (gesture.kind === 'maybe' && Math.hypot(dx, dy) > 8) gesture.kind = 'pan';
  if (gesture.kind === 'pan') { V.x = gesture.vx - dx / V.s; V.y = gesture.vy - dy / V.s; V.follow = false; labelsDirty = true; draw(); } });
const endPtr = e => { const g = gesture; ptrs.delete(e.pointerId);
  if (g && g.kind === 'maybe' && ptrs.size === 0 && performance.now() - g.t < 500) onTap(e.offsetX, e.offsetY);
  if (ptrs.size === 0) gesture = null; else if (g && g.kind === 'pinch') { const [p] = [...ptrs.values()]; gesture = { kind: 'pan', sx: p[0], sy: p[1], vx: V.x, vy: V.y }; } };
cv.addEventListener('pointerup', endPtr); cv.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); gesture = null; });
cv.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
function zoomAt(sx, sy, f) { const [wx, wy] = toWorld(sx, sy); V.s = clampScale(V.s * f); V.x = wx - (sx - W / 2) / V.s; V.y = wy - (sy - H / 2) / V.s; labelsDirty = true; draw(); }
document.getElementById('zin').onclick = () => zoomAt(W / 2, H / 2, 1.6);
document.getElementById('zout').onclick = () => zoomAt(W / 2, H / 2, 1 / 1.6);
document.getElementById('recenter').onclick = () => { if (S.real && S.real.pos) { V.x = S.real.pos[0]; V.y = S.real.pos[1]; } else { V.x = P.x; V.y = P.y; } V.follow = true; if (V.s < 0.5) V.s = 0.9; labelsDirty = true; draw(); };
document.getElementById('menuBtn').onclick = () => openMenu();

function hitTest(sx, sy) {
  let best = null, bd = 24;
  for (const p of PLACES) { const [x, y] = toScreen(p.x, p.y), d = Math.hypot(x - sx, y - sy); if (d < bd) { bd = d; best = { kind: 'place', p }; } }
  if (V.s > 0.16) for (const s of Object.values(ST)) { const [x, y] = toScreen(s.x, s.y), d = Math.hypot(x - sx, y - sy); if (d < bd - 4) { bd = d; best = { kind: 'station', s }; } }
  return best;
}
function onTap(sx, sy) {
  const hit = hitTest(sx, sy);
  if (S.mode !== 'play') { if (hit && hit.kind === 'place') showPlaceCard(hit.p, false); return; }
  if (P.train) { toast('We’re on the train. Choose a stop below to get off.'); return; }
  if (P.at.kind === 'offmap') { toast('This station is outside our street map. Take a train from here.'); return; }
  if (hit && hit.kind === 'place' && !hit.p.onMap) { showPlaceCard(hit.p, false); return; }
  let target, arrive = null;
  if (hit && hit.kind === 'station' && hit.s.onMap) { target = hit.s.node; arrive = () => enterStation(hit.s.name); }
  else if (hit && hit.kind === 'place') { target = hit.p.node; arrive = () => arrivePlace(hit.p); }
  else { const [wx, wy] = toWorld(sx, sy); if (!inMap(wx, wy)) { toast('That’s outside our street map.'); return; } target = nearestNode(wx, wy); }
  if (hit && hit.kind === 'station' && !hit.s.onMap) { toast(`${hit.s.name} is outside our street map. Ride a train there.`); return; }
  walkTo(target, arrive);
}

// ------------------------------------------------------------------ walking
function walkTo(target, onArrive) {
  let start;
  if (P.path) start = P.path[Math.min(P.pathI + 1, P.path.length - 1)];
  else if (P.at.kind === 'station') start = ST[P.at.st].node;
  else start = P.at.node;
  const path = walkPath(start, target); if (!path) { toast('We can’t find a way there on foot.'); return; }
  if (P.at.kind === 'station') { addMinutes(STAIRS); learn('Ausgang'); }
  P.at = { kind: 'street', node: start };
  P.path = path; P.pathI = 0; P.pathSeg = 0; P.onArrive = onArrive;
  // start from the current position toward first node
  P.legFrom = [P.x, P.y]; V.follow = true; P.street = null; atNode(0); learn('zu Fuß'); showMissionSheet();
}
function stepWalk(dtReal) {
  const speed = 140 * dtReal; // world meters per real second
  let remain = speed;
  while (remain > 0 && P.path) {
    const tgt = P.path[P.pathI + 1];
    if (tgt === undefined) { finishWalk(); break; }
    const tx = NX[tgt], ty = NY[tgt], d = DIST(P.x, P.y, tx, ty);
    if (d <= remain) { P.x = tx; P.y = ty; remain -= d; P.pathI++; walkedMeters(d); P.at = { kind: 'street', node: tgt }; atNode(P.pathI); }
    else { P.x += (tx - P.x) / d * remain; P.y += (ty - P.y) / d * remain; walkedMeters(remain); remain = 0; }
  }
}
function atNode(i) {
  const path = P.path; if (!path) return;
  const n = path[i], nx = path[i + 1], pv = path[i - 1];
  if (nx !== undefined) { const nm = edgeName.get(ekey(n, nx)) || '';
    if (nm && nm !== P.street) { P.street = nm; showStreetSign(nm); const low = nm.toLowerCase();
      for (const [suf, w] of STREET_WORDS) if (low.endsWith(suf) || low.includes(suf + ' ')) { learn(w); break; }
      if (/^neue[rsnm]? /i.test(nm)) learn('neu'); if (/^alte[rsnm]? |^alt-/i.test(nm)) learn('alt'); } }
  if (pv !== undefined && nx !== undefined && adj[n].length >= 6) {
    const a1 = Math.atan2(NY[n] - NY[pv], NX[n] - NX[pv]), a2 = Math.atan2(NY[nx] - NY[n], NX[nx] - NX[n]);
    let t = a2 - a1; while (t > Math.PI) t -= 2 * Math.PI; while (t < -Math.PI) t += 2 * Math.PI;
    if (Math.abs(t) > 0.9) learn(t > 0 ? 'rechts' : 'links'); else if (Math.abs(t) < 0.25 && ++P.straight > 3) learn('geradeaus');
  }
}
const signEl = document.getElementById('streetsign');
function showStreetSign(nm) { if (!signEl) return; signEl.textContent = nm; signEl.hidden = false; }
function hideStreetSign() { if (signEl) signEl.hidden = true; }
function walkedMeters(m) {
  const mins = m / WALK; addMinutes(mins);
  const drain = (S.rain ? 1.15 : 0.7) + (isDark() ? 0.3 : 0) + (S.temp <= 2 ? 0.2 : 0);
  setWarmth(S.warmth - drain * mins);
  for (const p of PLACES) if (p.onMap && !S.visited.has(p.id) && DIST(P.x, P.y, p.x, p.y) < 45) visit(p, true);
}
function finishWalk() { const cb = P.onArrive; P.path = null; P.onArrive = null; showMissionSheet(); if (cb) cb(); }

// ------------------------------------------------------------------ time, warmth, words
function addMinutes(m) { S.min += m; }
function setWarmth(v) {
  const before = S.warmth; S.warmth = Math.max(0, Math.min(100, v));
  if (S.mode === 'play') { if (S.warmth < 35 && before >= 35) learn('kalt'); if (S.warmth >= 100 && before < 60) learn('warm'); }
  if (S.warmth <= 0 && S.mode === 'play' && !S.coldShown) { S.coldShown = true; coldStop(); }
}
function coldStop() {
  P.path = null; hideStreetSign(); learn('Eine heiße Schokolade, bitte'); learn('Bitte'); learn('Danke');
  sheet(`<div class="eyebrow">Too cold</div><h2>Brrr. Time to warm up</h2>
    <p>We’ve been walking in the cold for too long. We stop in a café for hot chocolate. That takes 20 minutes.</p>
    <p class="muted">Tip: in drizzle or after dark, take the U-Bahn or S-Bahn for longer trips. Trains are warm.</p>
    <div class="row"><button class="btn primary" id="cafeOk">Warm again, keep going</button></div>`);
  document.getElementById('cafeOk').onclick = () => { addMinutes(20); setWarmth(70); S.coldShown = false; showMissionSheet(); };
}
const wordQueue = [];
function learn(word) {
  if (!WORDS[word] || save.words[word]) return; save.words[word] = true; persist();
  wordQueue.push(word); if (wordQueue.length === 1) showNextWord();
}
function showNextWord() {
  const word = wordQueue[0]; if (!word) return;
  const t = document.createElement('div'); t.className = 'toast word'; t.innerHTML = `New word: <b>${esc(word)}</b> = ${esc(WORDS[word][0])}`;
  pushToast(t, 3600); setTimeout(() => { wordQueue.shift(); showNextWord(); }, 1900);
}
const learnNext = list => { const w = list.find(x => !save.words[x]); if (w) learn(w); };
function toast(msg, ms = 2600) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; pushToast(t, ms); }
function pushToast(el, ms) { const box = document.getElementById('toasts'); box.style.bottom = (sheetEl.hidden ? 20 : sheetEl.offsetHeight + 12) + 'px'; box.appendChild(el); while (box.children.length > 3) box.firstChild.remove(); setTimeout(() => el.remove(), ms); }
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ------------------------------------------------------------------ places
function visit(p, passing) {
  if (S.visited.has(p.id)) return; S.visited.add(p.id);
  const first = !save.found[p.id]; save.found[p.id] = true; persist();
  if (first || (S.mission && S.mission.goal.includes(p.id))) toast(`${passing ? 'Passing' : 'Found'}: ${p.name}`);
  if (p.cat === 'market') learn('Weihnachtsmarkt');
  (PLACE_WORDS[p.id] || []).forEach(learn);
  checkMission();
}
function arrivePlace(p) { visit(p, false); if (p.id === 'A') { learn('Hallo'); learn('Tschüss'); } showPlaceCard(p, true); }
function showPlaceCard(p, here) {
  const kids = p.cat === 'market' ? (marketOpen(p) ? `Open now until 22:00.` : (S.day < 1 ? 'Markets usually open on Monday 23 November. Check the dates before you go.' : `Opens at ${p.opens}:00, closes at 22:00.`))
    : p.cat === 'museum' ? (museumOpen() ? 'Open now (most museums open 10:00 to 18:00).' : 'Closed now. Most museums open 10:00 to 18:00.') : '';
  if (p.cat === 'market' || p.cat === 'museum') learn((p.cat === 'market' ? marketOpen(p) : museumOpen()) ? 'geöffnet' : 'geschlossen');
  const canWarm = here && S.mode === 'play' && ((p.cat === 'market' && marketOpen(p)) || (p.cat === 'museum' && museumOpen()));
  sheet(`<div class="eyebrow">${{ home: 'Home base', friend: 'Friend', film: 'Film location', sight: 'Sight', museum: 'Museum', market: 'Christmas market' }[p.cat]} · ${esc(p.id)}</div>
    <h2>${esc(p.name)}</h2><div class="muted">${esc(p.de)}</div>
    <p>${esc(p.about)}</p><p><b>Look for:</b> ${esc(p.look)}</p>${kids ? `<p class="muted">${kids}</p>` : ''}${p.note ? `<p class="muted">${esc(p.note)}</p>` : ''}
    <div class="row">${canWarm ? `<button class="btn primary" id="goIn">${p.cat === 'market' ? 'Have a Kinderpunsch (20 min)' : 'Go inside (60 min)'}</button>` : ''}
    <button class="btn ${canWarm ? 'ghost' : 'primary'}" id="cardOk">${S.mode === 'play' ? 'Back to the map' : 'Close'}</button></div>`);
  if (canWarm) document.getElementById('goIn').onclick = () => { const m = p.cat === 'market' ? 20 : 60; addMinutes(m); S.paused += m; setWarmth(100);
    if (p.cat === 'market') { learn('Kinderpunsch'); learn('Bitte'); learn('Pfand'); learnNext(MARKET_FOODS); } else { learn('Eingang'); learn('Eintritt'); learn('Kasse'); } toast('Warm again'); showMissionSheet(); };
  document.getElementById('cardOk').onclick = () => S.mode === 'play' ? showMissionSheet() : (S.mode === 'real' ? realSheet() : hideSheet());
}

// ------------------------------------------------------------------ stations and trains
function enterStation(name) {
  const s = ST[name]; P.at = { kind: s.onMap ? 'station' : 'offmap', st: name }; P.x = s.x; P.y = s.y;
  if (/straße/i.test(name)) learn('Straße'); if (/platz/i.test(name)) learn('Platz'); if (/brücke/i.test(name)) learn('Brücke'); if (/tor$/i.test(name)) learn('Tor');
  stationSheet();
}
function stationSheet() {
  const name = P.at.st, s = ST[name], kinds = stKinds(s), scene = sceneByStation[name];
  const dirs = [];
  for (const { line: l, i } of s.lines) { if (i < l.stops.length - 1) dirs.push([l, 1]); if (i > 0) dirs.push([l, -1]); }
  dirs.sort((a, b) => a[0].ref.localeCompare(b[0].ref, 'en', { numeric: true }));
  hideStreetSign(); learn('Linie');
  sheet(`<div class="sign">${kinds.map(k => `<span class="sym ${k.toLowerCase()}">${k}</span>`).join('')}<span>${esc(name)}</span></div>
    ${!s.onMap ? `<p class="muted">This station is outside our street map.</p>` : ''}
    ${scene ? `<button class="btn primary" id="sceneGo" style="margin:8px 0">Walk to ${esc(scene.name)} (${scene.scene.walk} min)</button>` : ''}
    <div class="eyebrow" style="margin-top:6px">Which train? Pick a line and its Richtung</div>
    <div class="dirs">${dirs.map(([l, d], k) => { const term = lineTerm(l, d), i = s.lines.find(e => e.line === l).i, next = l.stops[i + d];
      return `<button class="dir" data-k="${k}"><span class="badge ${l.kind === 'S' ? 's' : ''}" style="background:${l.color}">${l.ref}</span><span class="to">Richtung ${esc(term)}<small>next stop: ${esc(next)}</small></span></button>`; }).join('')}</div>
    <div class="row">${s.onMap ? '<button class="btn ghost" id="leaveSt">Leave the station (Ausgang)</button>' : ''}${hintBtn()}</div>`);
  learn('Richtung');
  document.querySelectorAll('.dir').forEach(b => b.onclick = () => { const [l, d] = dirs[+b.dataset.k]; board(l, d); });
  const lv = document.getElementById('leaveSt'); if (lv) lv.onclick = () => { learn('Ausgang'); addMinutes(STAIRS); P.at = { kind: 'street', node: s.node }; P.x = NX[s.node]; P.y = NY[s.node]; showMissionSheet(); };
  if (scene) document.getElementById('sceneGo').onclick = () => doScene(scene);
  wireHint();
}
function doScene(p) {
  addMinutes(p.scene.walk); setWarmth(S.warmth - p.scene.walk * (S.rain ? 1.15 : 0.7));
  visit(p, false);
  sheet(`<div class="eyebrow">${esc(p.scene.walk)} minutes on foot from ${esc(p.scene.station)}</div><h2>${esc(p.name)}</h2>
    <p>${esc(p.scene.text)}</p><p><b>Look for:</b> ${esc(p.look)}</p>
    <div class="row">${(p.cat === 'market' && marketOpen(p)) ? '<button class="btn primary" id="sceneWarm">Have a Kinderpunsch (20 min)</button>' : ''}<button class="btn ${p.cat === 'market' && marketOpen(p) ? 'ghost' : 'primary'}" id="sceneBack">Walk back to the station (${p.scene.walk} min)</button></div>`);
  const wb = document.getElementById('sceneWarm'); if (wb) wb.onclick = () => { addMinutes(20); S.paused += 20; setWarmth(100); learn('Kinderpunsch'); learnNext(MARKET_FOODS); wb.remove(); };
  document.getElementById('sceneBack').onclick = () => { addMinutes(p.scene.walk); setWarmth(S.warmth - p.scene.walk * 0.8); if (S.mode === 'play' && !S.done) stationSheet(); };
}
function board(l, dir) {
  hideStreetSign();
  const s = ST[P.at.st], i = s.lines.find(e => e.line === l).i;
  P.train = { line: l, dir, i, t: 0, wait: WAIT(l), getOff: false, phase: 'wait', stopT: 0 };
  learn(l.kind === 'U' ? 'Zurückbleiben, bitte!' : 'Einsteigen, bitte');
  if (S.mission && S.mission.goal.length) { // gentle direction check: does riding on make the best remaining trip longer?
    const left = S.mission.goal.filter(g => !S.visited.has(g)); const li = LINES.indexOf(l);
    if (left.length && l.stops[i + dir]) { const here = bestPlan(stIndex[s.name], left).mins, on = bestPlan(lsBase[li] + i + dir, left).mins + segMinutes(l, Math.min(i, i + dir), Math.max(i, i + dir));
      P.train.wrongWay = on > here - 0.5; }
  }
  rideSheet();
}
function rideSheet() {
  const T = P.train, l = T.line, here = l.stops[T.i], next = l.stops[T.i + T.dir], ahead = [];
  for (let k = T.i + T.dir, n = 0; k >= 0 && k < l.stops.length && n < 5; k += T.dir, n++) ahead.push(l.stops[k]);
  const offOK = next && (ST[next].onMap || sceneByStation[next] || true);
  sheet(`<div class="row"><span class="badge ${l.kind === 'S' ? 's' : ''}" style="background:${l.color}">${l.ref}</span><b>Richtung ${esc(lineTerm(l, T.dir))}</b></div>
    <div class="display"><div class="small">${T.phase === 'wait' ? 'Abfahrt in ' + Math.ceil(T.wait) + ' Min · next train in ' + Math.ceil(T.wait) + ' min' : (T.phase === 'stop' ? 'Now at' : 'Nächster Halt')}</div>
    <div class="big">${esc(T.phase === 'stop' ? here : (T.phase === 'wait' ? here : next || here))}</div>
    ${T.phase === 'move' && next ? `<div class="small">Ausstieg ${doorSide(next) ? 'links · doors on the left' : 'rechts · doors on the right'}</div>` : ''}</div>
    ${ahead.length ? `<div class="stops">Coming up: ${ahead.map((n, k) => k === 0 ? `<b>${esc(n)}</b>` : esc(n)).join(' · ')}</div>` : ''}
    ${T.wrongWay && T.phase !== 'wait' && T.i !== undefined ? '<p class="muted">Hmm. Our goal seems to be the other way. Check the Richtung: it names the last station the train goes to.</p>' : ''}
    <div class="row">${next && offOK ? `<button class="btn ${T.getOff ? '' : 'primary'}" id="offBtn">${T.getOff ? 'Getting off at ' + esc(next) + ' ✓' : 'Get off at ' + esc(next)}</button>` : ''}
    ${T.phase === 'stop' ? `<button class="btn ghost" id="offHere">Get off here</button>` : ''}</div>`);
  const ob = document.getElementById('offBtn'); if (ob) ob.onclick = () => { T.getOff = !T.getOff; rideSheet(); };
  const oh = document.getElementById('offHere'); if (oh) oh.onclick = () => alight();
}
function doorSide(name) { let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) | 0; return (h & 1) === 0; }
function stepTrain(dtReal) {
  const T = P.train, l = T.line;
  if (T.phase === 'wait') { const dm = dtReal * 2.2; T.wait -= dm; addMinutes(dm); if (T.wait <= 0) { T.phase = 'move'; T.t = 0; learn('Abfahrt'); learn('Nächster Halt'); learn('Ausstieg links'); rideSheet(); } else if (Math.ceil(T.wait + dm) !== Math.ceil(T.wait)) rideSheet(); return; }
  if (T.phase === 'stop') { T.stopT -= dtReal; if (T.stopT <= 0) {
      if (T.getOff) return alight();
      if (T.i + T.dir < 0 || T.i + T.dir >= l.stops.length) { toast('Endstation. Bitte alle aussteigen! (Last stop, everyone off.)'); learn('Endstation'); return alight(); }
      T.phase = 'move'; T.t = 0; rideSheet(); } return; }
  const a = ST[l.stops[T.i]], b = ST[l.stops[T.i + T.dir]]; const mins = segMinutes(l, Math.min(T.i, T.i + T.dir), Math.max(T.i, T.i + T.dir));
  const dur = Math.max(0.9, Math.min(3.2, mins * 0.55)); const dt = dtReal / dur; T.t = Math.min(1, T.t + dt); addMinutes(mins * dt); setWarmth(S.warmth + 2.5 * mins * dt);
  const e = T.t < .5 ? 2 * T.t * T.t : 1 - (-2 * T.t + 2) ** 2 / 2; P.x = a.x + (b.x - a.x) * e; P.y = a.y + (b.y - a.y) * e;
  if (T.t >= 1) { T.i += T.dir; T.phase = 'stop'; T.stopT = T.getOff ? 0.5 : 1.3;
    const atEnd = T.i + T.dir < 0 || T.i + T.dir >= l.stops.length; if (atEnd) T.stopT = 0.6;
    if (T.getOff) T.stopT = 0.5; rideSheet(); }
}
function alight() { const T = P.train, name = T.line.stops[T.i]; P.train = null; learn('aussteigen');
  if (ST[name].lines.length > 1) learn('Umsteigen');
  enterStation(name); }

// ------------------------------------------------------------------ missions
function nextGoal() { if (!S.mission) return null; const left = S.mission.goal.filter(g => !S.visited.has(g)).map(g => PL[g]);
  if (!left.length) return null; left.sort((a, b) => DIST(P.x, P.y, a.x, a.y) - DIST(P.x, P.y, b.x, b.y)); return left[0]; }
function startMission(m) {
  S.mode = 'play'; S.mission = m; S.day = m.day; S.min = m.time; S.temp = m.temp; S.rain = m.rain; S.warmth = 100; S.coldShown = false; S.done = false;
  S.visited = new Set(); S.paused = 0; S.hint = null; S.hintUsed = false; P.train = null; P.path = null;
  if (m.start.place) { const p = PL[m.start.place]; P.at = { kind: 'street', node: p.node }; P.x = p.x; P.y = p.y; S.visited.add(p.id); }
  else { const s = ST[m.start.station]; P.x = s.x; P.y = s.y; P.at = { kind: 'street', node: s.node }; P.x = NX[s.node]; P.y = NY[s.node]; }
  const plan = bestPlan(playerGraphNode(), m.goal); S.par = Math.max(4, plan.mins); S.started = S.min;
  V.x = P.x; V.y = P.y; V.s = 0.9; V.follow = true; labelsDirty = true;
  hideOverlay(); hideStreetSign();
  const d0 = DAYS[m.day]; learn(m.time < 11 * 60 ? 'Guten Morgen' : m.time < d0.set ? 'Guten Tag' : 'Guten Abend'); learn('Uhr');
  if (m.rain) learn('Nieselregen'); if (isDark()) learn('dunkel');
  m.words.slice(0, 2).forEach(learn);
  sheet(`<div class="eyebrow">${esc(DAYS[m.day].label)} · ${fmt(m.time)} · ${m.temp} °C${m.rain ? ', drizzle' : ''}</div><h2>${esc(m.title)}</h2><p>${esc(m.story)}</p>
    <p class="muted">Tap the map, a place or a station to walk there. Pinch or use + and − to zoom.</p>
    <div class="row"><button class="btn primary" id="go">Let’s go</button></div>`);
  document.getElementById('go').onclick = () => showMissionSheet();
  updateHud();
}
function startExplore() {
  hideStreetSign(); S.mode = 'play'; S.mission = null; S.day = 1; S.min = 10 * 60; S.temp = 4; S.rain = false; S.warmth = 100; S.visited = new Set(['H']); S.hint = null; S.done = false;
  const p = PL.H; P.at = { kind: 'street', node: p.node }; P.x = p.x; P.y = p.y; P.train = null; P.path = null;
  V.x = P.x; V.y = P.y; V.s = 0.7; labelsDirty = true; hideOverlay(); showMissionSheet(); updateHud();
}
function checkMission() {
  const m = S.mission; if (!m || S.done) return;
  if (!m.goal.every(g => S.visited.has(g))) { showMissionSheet(); return; }
  S.done = true; P.path = null; P.onArrive = null; const used = S.min - S.started - S.paused, ratio = used / S.par;
  let stars = ratio <= 1.2 ? 3 : ratio <= 1.7 ? 2 : 1; if (S.hintUsed) stars = Math.min(stars, 2);
  const prev = save.stars[m.id] || 0; if (stars > prev) { save.stars[m.id] = stars; persist(); }
  const start = m.start.place ? PL[m.start.place].node : stIndex[m.start.station] ;
  const plan = bestPlan(m.start.place ? start : ST[m.start.station].node, m.goal);
  const steps = plan.legs.flatMap(lg => describeLeg(lg).steps.concat([{ kind: 'arrive', p: lg.p }]));
  setTimeout(() => {
    P.path = null;
    sheet(`<div class="eyebrow">Mission complete</div><h2>${esc(m.title)}</h2>
    <div class="stars" style="font-size:28px">${'★'.repeat(stars)}<span class="off">${'★'.repeat(3 - stars)}</span></div>
    <p>We took <b>${Math.round(used)} min</b>. The quickest way takes about <b>${Math.round(S.par)} min</b>.${S.hintUsed ? ' (We used the hint, so 2 stars at most.)' : ''}</p>
    <div class="eyebrow">The quickest way</div><ol style="margin:6px 0 12px;padding-left:20px;line-height:1.5">${steps.map(stepHtml).join('')}</ol>
    <div class="row"><button class="btn primary" id="nextM">Next mission</button><button class="btn ghost" id="again">Play again</button><button class="btn ghost" id="toMenu">Menu</button></div>`);
    learn('Ja / Nein'); const idx = MISSIONS.indexOf(m); document.getElementById('nextM').onclick = () => startMission(MISSIONS[(idx + 1) % MISSIONS.length]);
    document.getElementById('again').onclick = () => startMission(m); document.getElementById('toMenu').onclick = () => openMenu('missions');
  }, 700);
}
function stepHtml(s) {
  if (s.kind === 'walk') return `<li>Walk about ${Math.max(1, Math.round(s.mins))} min</li>`;
  if (s.kind === 'ride') return `<li><span class="badge ${s.line.kind === 'S' ? 's' : ''}" style="background:${s.line.color};height:20px;min-width:30px;font-size:15px">${s.line.ref}</span> from ${esc(s.from)}, Richtung ${esc(lineTerm(s.line, s.dir))}, ${s.stops} stop${s.stops > 1 ? 's' : ''} to <b>${esc(s.to)}</b></li>`;
  return `<li>Arrive: ${esc(s.p.name)}${s.p.scene ? ` (${s.p.scene.walk} min walk from the station)` : ''}</li>`;
}
function hintBtn() { return S.mission && !S.done ? '<button class="btn ghost" id="hintBtn">Show the quickest way</button>' : ''; }
function wireHint() { const b = document.getElementById('hintBtn'); if (!b) return; b.onclick = () => {
  const left = S.mission.goal.filter(g => !S.visited.has(g)); if (!left.length) return;
  const src = P.at.kind === 'station' || P.at.kind === 'offmap' ? stIndex[P.at.st] : (P.path ? P.path[Math.min(P.pathI + 1, P.path.length - 1)] : P.at.node);
  const plan = bestPlan(src, left); S.hintUsed = true; learn('Wo ist …?'); learn('Entschuldigung'); learn('Sprechen Sie Englisch?'); const ds = plan.legs.map(describeLeg); S.hint = ds.map(d => d.poly.map(([x, y]) => [x, y]));
  const steps = plan.legs.flatMap((lg, k) => ds[k].steps.concat([{ kind: 'arrive', p: lg.p }]));
  sheet(`<div class="eyebrow">Quickest way from here · about ${Math.round(plan.mins)} min</div><ol style="margin:6px 0 12px;padding-left:20px;line-height:1.5">${steps.map(stepHtml).join('')}</ol>
    <p class="muted">The dotted yellow line shows it on the map.</p><div class="row"><button class="btn primary" id="hintOk">Got it</button></div>`);
  document.getElementById('hintOk').onclick = () => (P.at.kind === 'station' || P.at.kind === 'offmap') ? stationSheet() : showMissionSheet(); }; }
function showMissionSheet() {
  if (S.mode !== 'play' || P.train) return;
  if (P.at.kind === 'offmap') return stationSheet();
  const m = S.mission;
  if (!m) { const found = Object.keys(save.found).length;
    sheet(`<div class="eyebrow">Explore · ${found} of ${PLACES.length} places found</div><h2>Wander anywhere</h2>
      <p>Tap a numbered place to walk there, or a <span class="sym u" style="width:18px;height:18px;font-size:14px">U</span> or <span class="sym s" style="width:18px;height:18px;font-size:14px">S</span> station to ride a train.</p>
      <div class="row"><button class="btn ghost" id="toMenu">Menu</button></div>`);
    document.getElementById('toMenu').onclick = () => openMenu(); return; }
  if (S.done) return;
  const g = nextGoal();
  let comp = '';
  if (g) { const d = DIST(P.x, P.y, g.x, g.y), ang = Math.atan2(g.x - P.x, -(g.y - P.y)) * 180 / Math.PI;
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'], dn = dirs[Math.round(((ang + 360) % 360) / 45) % 8];
    const DE = { N: 'Norden', NE: 'Nordosten', E: 'Osten', SE: 'Südosten', S: 'Süden', SW: 'Südwesten', W: 'Westen', NW: 'Nordwesten' };
    if (dn.includes('N')) learn('Norden'); if (dn.includes('S')) learn('Süden'); if (dn.includes('E')) learn('Osten'); if (dn.includes('W')) learn('Westen');
    comp = `<div class="compass"><svg viewBox="0 0 24 24" style="transform:rotate(${ang}deg)"><path d="M12 2l6 18-6-4-6 4z" fill="#f3c22f"/></svg>${d > 950 ? (d / 1000).toFixed(1) + ' km' : Math.round(d / 10) * 10 + ' m'} ${dn} <span class="muted" style="font-weight:500">(${DE[dn]})</span> to ${esc(g.name)}</div>`; }
  sheet(`<div class="eyebrow">${esc(m.title)}</div>
    <div class="goals">${m.goal.map(id => `<div class="goal ${S.visited.has(id) ? 'done' : ''}"><div class="tick">${S.visited.has(id) ? '✓' : ''}</div><span>${esc(PL[id].name)}</span></div>`).join('')}</div>
    ${comp}<div class="row" style="margin-top:10px">${P.path ? '<span class="muted">Walking…</span>' : ''}${hintBtn()}<button class="btn ghost" id="toMenu">Menu</button></div>`);
  wireHint(); document.getElementById('toMenu').onclick = () => openMenu('missions');
}

// ------------------------------------------------------------------ sheet + overlay
const sheetEl = document.getElementById('sheet'), ov = document.getElementById('overlay');
function sheet(html) { sheetEl.hidden = false; sheetEl.innerHTML = html; const box = document.getElementById('toasts'); if (box) box.style.bottom = (sheetEl.offsetHeight + 12) + 'px'; }
function hideSheet() { sheetEl.hidden = true; }
function hideOverlay() { ov.hidden = true; }
const fmt = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
function openMenu(tab) {
  ov.hidden = false; const done = Object.keys(save.stars).length, found = Object.keys(save.found).length, words = Object.keys(save.words).length;
  if (tab === 'missions') return missionsList();
  if (tab === 'places') return placesList();
  if (tab === 'words') return wordsList();
  ov.innerHTML = `<div class="wrap"><div class="title-hero"><h1>Berlin<span>Unterwegs</span></h1>
    <div class="tracks">${['#224F86', '#DA421E', '#7DAD4C', '#8C6DAB', '#EB7405', '#0066AD'].map(c => `<i style="background:${c}"></i>`).join('')}</div>
    <p><i>Unterwegs</i> means “out and about”. Practice finding our way around Berlin before the trip, on real streets and real train lines, in late-November weather.</p></div>
    <div class="menu">
      ${S.mode === 'play' ? '<button class="btn primary" id="resume">Back to the game <small>keep going</small></button>' : ''}
      <button class="btn ${S.mode === 'play' ? '' : 'primary'}" id="mMissions">Missions <small>${done} of ${MISSIONS.length} done</small></button>
      <button class="btn" id="mExplore">Explore freely <small>${found} of ${PLACES.length} places found</small></button>
      <button class="btn" id="mPlaces">Our places <small>Dad’s list, Andy’s, the hotel</small></button>
      <button class="btn" id="mWords">German words <small>${words} of ${Object.keys(WORDS).length} learned</small></button>
      <button class="btn" id="mReal">We’re in Berlin <small>show where we really are</small></button>
    </div>
    <p class="small-print">Map data © OpenStreetMap contributors (ODbL), downloaded 15 Nov 2026. Train lines and stops are real; times are estimates. Christmas market dates and hours are typical and change each year, so check before going. Progress is saved on this phone only.</p>
    ${(window.__offlineReady || (navigator.serviceWorker && navigator.serviceWorker.controller)) ? '<p class="small-print" style="color:var(--good);margin-top:6px">✓ Saved on this phone. The game works without internet.</p>' : ''}
    <div class="row" style="margin-top:8px"><button class="btn ghost" id="mReset">Reset progress</button></div></div>`;
  const on = (id, f) => { const b = document.getElementById(id); if (b) b.onclick = f; };
  on('resume', () => { hideOverlay(); }); on('mMissions', missionsList); on('mExplore', startExplore); on('mPlaces', placesList); on('mWords', wordsList); on('mReal', startReal);
  on('mReset', () => { const b = document.getElementById('mReset'); if (b.dataset.sure) { save = { stars: {}, found: {}, words: {} }; persist(); openMenu(); } else { b.dataset.sure = '1'; b.textContent = 'Tap again to erase stars, places and words'; } });
}
function ovHead(title) { return `<div class="ovhead"><h1>${title}</h1><button class="btn ghost" id="back">Back</button></div>`; }
function missionsList() {
  ov.hidden = false;
  ov.innerHTML = `<div class="wrap">${ovHead('Missions')}<div class="list">${MISSIONS.map((m, i) => { const st = save.stars[m.id] || 0;
    return `<button class="item" data-i="${i}"><div class="num" style="background:var(--panel-2)">${i + 1}</div><div><h3>${esc(m.title)}</h3><p>${esc(DAYS[m.day].label)} · ${fmt(m.time)} · ${m.temp} °C${m.rain ? ', drizzle' : ''}${isNightAt(m) ? ', dark' : ''}</p></div>
    <div class="stars">${'★'.repeat(st)}<span class="off">${'★'.repeat(3 - st)}</span></div></button>`; }).join('')}</div></div>`;
  document.getElementById('back').onclick = () => openMenu();
  ov.querySelectorAll('.item').forEach(b => b.onclick = () => startMission(MISSIONS[+b.dataset.i]));
}
function isNightAt(m) { const d = DAYS[m.day]; return m.time > d.set + 10; }
function placesList() {
  ov.hidden = false; const groups = [['Our spots', ['home', 'friend', 'film']], ['Sights', ['sight']], ['Museums', ['museum']], ['Christmas and winter markets', ['market']]];
  ov.innerHTML = `<div class="wrap">${ovHead('Our places')}${groups.map(([t, cats]) => `<div class="sec">${t}</div><div class="list">${PLACES.filter(p => cats.includes(p.cat)).map(p =>
    `<button class="item" data-id="${p.id}"><div class="num" style="background:${CATCOLOR[p.cat]}">${esc(p.id)}</div><div><h3>${esc(p.name)}</h3><p>${esc(p.look)}</p></div><div class="stars">${save.found[p.id] ? '✓' : ''}</div></button>`).join('')}</div>`).join('')}</div>`;
  document.getElementById('back').onclick = () => openMenu();
  ov.querySelectorAll('.item').forEach(b => b.onclick = () => { const p = PL[b.dataset.id]; hideOverlay(); V.x = p.x; V.y = p.y; V.s = p.onMap ? 1.1 : 0.06; V.follow = false; labelsDirty = true; showPlaceCard(p, false); draw(); });
}
function wordsList() {
  ov.hidden = false;
  const all = Object.entries(WORDS), got = all.filter(([w]) => save.words[w]).length;
  ov.innerHTML = `<div class="wrap">${ovHead('German words')}<p class="muted">${got} of ${all.length} found. Words unlock as they come up: on street signs, on the train, at places and markets, and in the weather.</p>
    ${WORD_TOPICS.map((t, ti) => { const ws = all.filter(([, v]) => v[2] === ti), n = ws.filter(([w]) => save.words[w]).length;
      return `<div class="sec">${t} · ${n}/${ws.length}</div><div class="list">${ws.map(([w, [en, tip]]) => save.words[w]
        ? `<div class="word"><b>${esc(w)}</b><span class="en">${esc(en)}</span><p>${esc(tip)}</p></div>` : `<div class="word locked"><b>• • •</b><p>Not found yet</p></div>`).join('')}</div>`; }).join('')}</div>`;
  document.getElementById('back').onclick = () => openMenu();
}

// ------------------------------------------------------------------ real mode (GPS)
function startReal() {
  hideOverlay(); S.mode = 'real'; S.real = { pos: null, acc: 0, watch: null, err: null }; S.min = new Date().getHours() * 60 + new Date().getMinutes();
  V.x = PL.H.x; V.y = PL.H.y; V.s = 0.6; labelsDirty = true;
  if (!('geolocation' in navigator)) { S.real.err = 'This phone or browser can’t share its location.'; realSheet(); return; }
  try {
    S.real.watch = navigator.geolocation.watchPosition(p => { const [x, y] = proj(p.coords.latitude, p.coords.longitude); const first = !S.real.pos; S.real.pos = [x, y]; S.real.acc = p.coords.accuracy || 30; S.real.err = null;
      if (first || V.follow) { V.x = x; V.y = y; if (first) { V.s = 1; V.follow = true; } labelsDirty = true; } realSheet(); },
      e => { S.real.err = e.code === 1 ? 'Location is turned off for this game. Allow location for it in your phone’s settings, then try again.' : 'We can’t find our location right now. Try outside, away from tall buildings.'; realSheet(); },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  } catch (e) { S.real.err = 'Location doesn’t work in this preview. It works in the installed version on your phone.'; }
  realSheet();
}
function realSheet() {
  const R = S.real; let body;
  if (R.err) body = `<p>${esc(R.err)}</p>`;
  else if (!R.pos) body = '<p>Finding where we are…</p>';
  else { const [x, y] = R.pos; const nearP = PLACES.filter(p => p.onMap || true).map(p => [p, DIST(x, y, p.x, p.y)]).sort((a, b) => a[1] - b[1]).slice(0, 3);
    const nearS = Object.values(ST).map(s => [s, DIST(x, y, s.x, s.y)]).sort((a, b) => a[1] - b[1])[0];
    const out = !inMap(x, y) ? '<p class="muted">We’re outside the street map, so only train lines are drawn here.</p>' : '';
    body = `${out}<p>Nearest station: <b>${esc(nearS[0].name)}</b> (${stKinds(nearS[0]).join(' and ')}), about ${Math.round(nearS[1] / WALK)} min on foot.</p>
      <div class="goals">${nearP.map(([p, d]) => `<div class="goal"><div class="num" style="background:${CATCOLOR[p.cat]};width:24px;height:24px;font-size:13px">${esc(p.id)}</div><span>${esc(p.name)} · ${d > 950 ? (d / 1000).toFixed(1) + ' km' : Math.round(d / 10) * 10 + ' m'}</span></div>`).join('')}</div>`; }
  sheet(`<div class="eyebrow">We’re in Berlin · real location</div>${body}<div class="row"><button class="btn ghost" id="realStop">Back to the game menu</button></div>`);
  document.getElementById('realStop').onclick = () => { if (R.watch != null) navigator.geolocation.clearWatch(R.watch); S.real = null; S.mode = 'title'; openMenu(); };
}

// ------------------------------------------------------------------ HUD + loop
const $ = id => document.getElementById(id);
const wxc = $('wxicon').getContext('2d');
let hudKey = '';
function updateHud() {
  const temp = Math.round(S.temp - (isDark() ? 1 : 0));
  const key = [fmt(S.min), S.day, temp, S.rain, Math.round(S.warmth), isDark()].join();
  if (key === hudKey) return; hudKey = key;
  $('clock').textContent = fmt(S.min); $('day').textContent = (DAYS[S.day] || DAYS[1]).label;
  $('wxtext').textContent = `${temp} °C${S.rain ? ' · drizzle' : ''}`;
  $('warmtxt').textContent = Math.round(S.warmth); const wb = $('warmbar'); wb.style.width = S.warmth + '%'; wb.style.background = S.warmth < 30 ? '#6aa9e8' : S.warmth < 60 ? '#e9b24b' : '#e9764b';
  wxc.clearRect(0, 0, 40, 40); // cloud, moon or sun, rain
  if (isDark()) { wxc.fillStyle = '#e8e3c8'; wxc.beginPath(); wxc.arc(26, 13, 8, 0, 7); wxc.fill(); wxc.fillStyle = '#26314a'; wxc.beginPath(); wxc.arc(30, 10, 7, 0, 7); wxc.fill(); }
  wxc.fillStyle = '#c9d2e0'; wxc.beginPath(); wxc.arc(14, 22, 8, 0, 7); wxc.arc(23, 19, 9, 0, 7); wxc.arc(30, 24, 6, 0, 7); wxc.rect(8, 22, 26, 8); wxc.fill();
  if (S.rain) { wxc.strokeStyle = '#7fb1e6'; wxc.lineWidth = 2.5; wxc.beginPath(); [12, 20, 28].forEach(x => { wxc.moveTo(x, 33); wxc.lineTo(x - 2, 38); }); wxc.stroke(); }
}
let last = performance.now(), settleT = 0;
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  let moving = false;
  if (S.mode === "play" && ov.hidden) {
    if (P.path) { stepWalk(dt); moving = true; }
    if (P.train) { stepTrain(dt); moving = true; }
  }
  if (moving && V.follow) { const [sx, sy] = toScreen(P.x, P.y); const mx = W * 0.25, my = H * 0.22;
    if (sx < mx || sx > W - mx || sy < my + 60 || sy > H - my - sheetEl.offsetHeight * 0.6) { V.x += (P.x - V.x) * 0.08; V.y += (P.y - V.y) * 0.08; settleT = 0.15; } }
  if (settleT > 0) { settleT -= dt; if (settleT <= 0) labelsDirty = true; }
  if (S.rain && !reduceMotion) for (const d of drops) { d.y += d.v * dt * 1.3; d.x -= d.v * dt * 0.25; if (d.y > 1) { d.y = 0; d.x = Math.random() * 1.1; } }
  updateHud();
  draw();
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------ boot
window.addEventListener('resize', resize);
resize();
V.x = PL.H.x; V.y = PL.H.y - 300; V.s = 0.16; S.day = 1; S.min = 16 * 60 + 40;
openMenu(); hideSheet();
window.addEventListener('offline-ready', () => { if (!ov.hidden && ov.querySelector('.title-hero')) openMenu(); });
requestAnimationFrame(loop);
window.__game = { S, P, V, PL, ST, LINES, bestPlan, describeLeg, startMission, MISSIONS };
})();
