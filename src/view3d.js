// ------------------------------------------------------------------ first-person street view (three.js)
// A cozy walk at eye level through real Berlin streets: building heights from OpenStreetMap,
// lit windows, street lamps, autumn trees, Christmas markets. Played with a controller (Razer Kishi),
// keyboard, or on-screen touch controls.
const V3 = { on: false }; // (overhead overlay mode, unused)
const FP = { on: false, ok: typeof THREE !== 'undefined', inited: false, yaw: -Math.PI / 2, pitch: -0.05, bob: 0, pad: false, prompt: null, moveX: 0, moveY: 0, lookX: 0, lookY: 0, run: false };
let R3 = null, SC = null, CAM = null, HEMI = null, SUN = null, BMAT = null, GMAT = null, GLOWMAT = null, MKTLIGHT = null, BEACON = null, HINTMESH = null;
const glEl = document.getElementById('gl');
const BLD_TILES = new Map(), TILE = 400, PLACE_SPRITES = [], STATION_SPRITES = [], MARKET_PARTS = [];
function project3() { return [-9999, -9999]; } function unproject3() { return [0, 0]; } function projLen() { return { len: 0, ang: 0 }; } function render3D() {}

// ---- data: buildings into tiles, street segments into a grid
function decodeBuildings() {
  const a = M.bld || []; let i = 0, id = 0;
  while (i < a.length) {
    const h = a[i] / 10, n = a[i + 1], pts = new Float32Array(n * 2); let x = a[i + 2], y = a[i + 3];
    pts[0] = x / 2; pts[1] = y / 2;
    for (let k = 1; k < n; k++) { x += a[i + 2 + 2 * k]; y += a[i + 3 + 2 * k]; pts[2 * k] = x / 2; pts[2 * k + 1] = y / 2; }
    i += 2 + 2 * n;
    let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
    for (let k = 0; k < n; k++) { minx = Math.min(minx, pts[2 * k]); maxx = Math.max(maxx, pts[2 * k]); miny = Math.min(miny, pts[2 * k + 1]); maxy = Math.max(maxy, pts[2 * k + 1]); }
    const tx = Math.floor(pts[0] / TILE), ty = Math.floor(pts[1] / TILE), key = tx + ',' + ty;
    if (!BLD_TILES.has(key)) BLD_TILES.set(key, { tx, ty, list: [], group: null, cx: (tx + 0.5) * TILE, cy: (ty + 0.5) * TILE });
    BLD_TILES.get(key).list.push({ h, pts, id: id++, minx, miny, maxx, maxy });
  }
  // empty tiles still get lamps and trees
  for (let tx = Math.floor(BX0 / TILE); tx <= Math.floor(BX1 / TILE); tx++) for (let ty = Math.floor(BY0 / TILE); ty <= Math.floor(BY1 / TILE); ty++) {
    const key = tx + ',' + ty; if (!BLD_TILES.has(key)) BLD_TILES.set(key, { tx, ty, list: [], group: null, cx: (tx + 0.5) * TILE, cy: (ty + 0.5) * TILE });
  }
}
const SGRID = new Map(), SCELL = 60, SWID = [17, 15, 13, 11, 8, 6];
function buildStreetGrid() {
  for (const w of ways) for (let i = 1; i < w.p.length; i++) {
    const a = w.p[i - 1], b = w.p[i], seg = { ax: NX[a], ay: NY[a], bx: NX[b], by: NY[b], w: SWID[w.c], name: w.name, c: w.c };
    const x0 = Math.floor(Math.min(seg.ax, seg.bx) / SCELL), x1 = Math.floor(Math.max(seg.ax, seg.bx) / SCELL), y0 = Math.floor(Math.min(seg.ay, seg.by) / SCELL), y1 = Math.floor(Math.max(seg.ay, seg.by) / SCELL);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const k = x + ',' + y; if (!SGRID.has(k)) SGRID.set(k, []); SGRID.get(k).push(seg); }
  }
}
function segDist(s, x, y) { const dx = s.bx - s.ax, dy = s.by - s.ay, L2 = dx * dx + dy * dy || 1; let t = ((x - s.ax) * dx + (y - s.ay) * dy) / L2; t = Math.max(0, Math.min(1, t)); return Math.hypot(x - s.ax - dx * t, y - s.ay - dy * t); }
function nearestStreet(x, y) {
  let best = null, bd = 1e9; const cx = Math.floor(x / SCELL), cy = Math.floor(y / SCELL);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const s of SGRID.get((cx + i) + ',' + (cy + j)) || []) { const d = segDist(s, x, y); if (d < bd) { bd = d; best = s; } }
  return best ? { seg: best, d: bd } : null;
}
function pip(p, x, y) { let inside = false; const n = p.length / 2; for (let i = 0, j = n - 1; i < n; j = i++) { const xi = p[2 * i], yi = p[2 * i + 1], xj = p[2 * j], yj = p[2 * j + 1]; if (((yi > y) !== (yj > y)) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside; } return inside; }
const WATER = M.water.map(r => { let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9; for (let i = 0; i < r.length; i += 2) { minx = Math.min(minx, r[i]); maxx = Math.max(maxx, r[i]); miny = Math.min(miny, r[i + 1]); maxy = Math.max(maxy, r[i + 1]); } return { p: r, minx, miny, maxx, maxy }; });
function inBuilding(x, y) {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const t = BLD_TILES.get((tx + i) + ',' + (ty + j)); if (!t) continue;
    for (const b of t.list) if (x > b.minx - 0.4 && x < b.maxx + 0.4 && y > b.miny - 0.4 && y < b.maxy + 0.4 && pip(b.pts, x, y)) return true; }
  return false;
}
function blocked(x, y) {
  if (x < BX0 + 10 || x > BX1 - 10 || y < BY0 + 10 || y > BY1 - 10) return true;
  if (inBuilding(x, y)) return true;
  const ns = nearestStreet(x, y); if (ns && ns.d < ns.seg.w / 2 + 2) return false; // streets and bridges are always fine
  for (const w of WATER) if (x > w.minx && x < w.maxx && y > w.miny && y < w.maxy && pip(w.p, x, y)) return true;
  return false;
}

// ---- textures made on the fly (no image files needed offline)
function canvasTex(w, h, paint) { const c = document.createElement('canvas'); c.width = w; c.height = h; paint(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); return t; }
let FACADE_TEX, WINDOW_TEX, GLOW_TEX;
function makeTextures() {
  // 4 windows across, 4 floors up; the bottom strip stays plain for roofs
  FACADE_TEX = canvasTex(256, 256, (g) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { const x = c * 64 + 20, y = r * 64 + 14;
      g.fillStyle = '#e9e6e0'; g.fillRect(x - 4, y - 4, 32, 44); g.fillStyle = '#4a5260'; g.fillRect(x, y, 24, 36); g.fillStyle = '#8d97a6'; g.fillRect(x + 11, y, 2, 36); g.fillRect(x, y + 14, 24, 2); }
    g.fillStyle = '#ffffff'; g.fillRect(0, 250, 256, 6);
  });
  WINDOW_TEX = canvasTex(256, 256, (g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
    const warm = ['#ffd38a', '#ffc46b', '#ffe2a8', '#f6b25e', '#fff0c8'];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { if (Math.random() < 0.42) { g.fillStyle = warm[(r * 4 + c) % warm.length]; g.fillRect(c * 64 + 20, r * 64 + 14, 24, 36); } }
  });
  for (const t of [FACADE_TEX, WINDOW_TEX]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; }
  GLOW_TEX = canvasTex(64, 64, (g) => { const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32); rg.addColorStop(0, 'rgba(255,214,140,1)'); rg.addColorStop(0.35, 'rgba(255,180,90,.5)'); rg.addColorStop(1, 'rgba(255,170,70,0)'); g.fillStyle = rg; g.fillRect(0, 0, 64, 64); });
}
function labelSprite(draw, w, h, scale) {
  const tex = canvasTex(w, h, draw); tex.minFilter = THREE.LinearFilter;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })); s.scale.set(scale * w / h, scale, 1); return s;
}

// ---- one tile of city: buildings, lamps, trees
const FACADES = [[0.88, 0.84, 0.77], [0.83, 0.80, 0.74], [0.90, 0.87, 0.80], [0.77, 0.75, 0.72], [0.84, 0.76, 0.63], [0.86, 0.80, 0.69], [0.79, 0.81, 0.83], [0.70, 0.45, 0.36], [0.80, 0.70, 0.66]];
const _m4 = typeof THREE !== 'undefined' ? new THREE.Matrix4() : null, _col = typeof THREE !== 'undefined' ? new THREE.Color() : null;
function rand(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function buildTile(t) {
  const grp = new THREE.Group(), pos = [], col = [], uv = [];
  for (const b of t.list) {
    const p = b.pts, n = p.length / 2, h = b.h, c = FACADES[((b.id * 2654435761) >>> 0) % FACADES.length], lo = c.map(v => v * 0.78);
    let run = 0; const vo = ((b.id * 7) % 4) * 0.25;
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n, ax = p[2 * k], ay = p[2 * k + 1], bx = p[2 * k2], by = p[2 * k2 + 1], L = Math.hypot(bx - ax, by - ay);
      const u0 = run / 14.4, u1 = (run + L) / 14.4, v1 = h / 13.2; run += L;
      pos.push(ax, 0, ay, bx, 0, by, bx, h, by, ax, 0, ay, bx, h, by, ax, h, ay);
      col.push(...lo, ...lo, ...c, ...lo, ...c, ...c);
      uv.push(u0, vo, u1, vo, u1, vo + v1, u0, vo, u1, vo + v1, u0, vo + v1);
    }
    const v2 = []; for (let k = 0; k < n; k++) v2.push(new THREE.Vector2(p[2 * k], p[2 * k + 1]));
    let tris = []; try { tris = THREE.ShapeUtils.triangulateShape(v2, []); } catch (e) {}
    const rc = [c[0] * 0.62, c[1] * 0.6, c[2] * 0.6];
    for (const tri of tris) for (const k of tri) { pos.push(v2[k].x, h, v2[k].y); col.push(...rc); uv.push(0.5, 0.01); }
  }
  if (pos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals(); grp.add(new THREE.Mesh(g, BMAT));
  }
  // street lamps along streets in this tile
  const lamps = [], x0 = t.tx * TILE, y0 = t.ty * TILE;
  for (const w of ways) { if (w.c > 4) continue;
    for (let i = 1; i < w.p.length; i++) { const a = w.p[i - 1], b = w.p[i], ax = NX[a], ay = NY[a], bx = NX[b], by = NY[b], L = Math.hypot(bx - ax, by - ay);
      for (let d = 12; d < L; d += 34) { const f = d / L, x = ax + (bx - ax) * f, y = ay + (by - ay) * f; if (x < x0 || x >= x0 + TILE || y < y0 || y >= y0 + TILE) continue;
        const side = (Math.floor(d / 34) % 2 ? 1 : -1) * (SWID[w.c] / 2 + 1.2), nx = -(by - ay) / L, ny = (bx - ax) / L, lx = x + nx * side, ly = y + ny * side;
        if (!inBuilding(lx, ly)) lamps.push([lx, ly]); } } }
  if (lamps.length) {
    const pole = new THREE.InstancedMesh(LAMP_GEO, LAMP_MAT, lamps.length);
    const gp = new Float32Array(lamps.length * 3);
    lamps.forEach(([x, y], i) => { _m4.makeTranslation(x, 0, y); pole.setMatrixAt(i, _m4); gp[3 * i] = x; gp[3 * i + 1] = 5.2; gp[3 * i + 2] = y; });
    grp.add(pole);
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(gp, 3)); grp.add(new THREE.Points(gg, GLOWMAT));
  }
  // trees in parks
  const trees = [], rnd = rand(t.tx * 7919 + t.ty * 104729);
  for (const r of M.parks) {
    let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9; for (let i = 0; i < r.length; i += 2) { minx = Math.min(minx, r[i]); maxx = Math.max(maxx, r[i]); miny = Math.min(miny, r[i + 1]); maxy = Math.max(maxy, r[i + 1]); }
    const ix0 = Math.max(minx, x0), ix1 = Math.min(maxx, x0 + TILE), iy0 = Math.max(miny, y0), iy1 = Math.min(maxy, y0 + TILE); if (ix0 >= ix1 || iy0 >= iy1) continue;
    const tries = Math.min(80, Math.floor((ix1 - ix0) * (iy1 - iy0) / 260));
    for (let k = 0; k < tries && trees.length < 220; k++) { const x = ix0 + rnd() * (ix1 - ix0), y = iy0 + rnd() * (iy1 - iy0); if (pip(r, x, y) && !inBuilding(x, y)) { const ns = nearestStreet(x, y); if (!ns || ns.d > ns.seg.w / 2 + 2) trees.push([x, y, 0.75 + rnd() * 0.6, Math.floor(rnd() * 5)]); } }
  }
  if (trees.length) {
    const trunk = new THREE.InstancedMesh(TRUNK_GEO, TRUNK_MAT, trees.length), crown = new THREE.InstancedMesh(CROWN_GEO, CROWN_MAT, trees.length);
    const AUTUMN = [0xb8862b, 0x9a5b2a, 0x6f7a3a, 0x8c6d4e, 0xc49a3a];
    trees.forEach(([x, y, s, ci], i) => { _m4.makeScale(s, s, s).setPosition(x, 0, y); trunk.setMatrixAt(i, _m4); crown.setMatrixAt(i, _m4); crown.setColorAt(i, _col.setHex(AUTUMN[ci])); });
    grp.add(trunk, crown);
  }
  t.group = grp; SC.add(grp);
}
let LAMP_GEO, LAMP_MAT, TRUNK_GEO, TRUNK_MAT, CROWN_GEO, CROWN_MAT;
function sharedGeometry() {
  const pole = new THREE.CylinderGeometry(0.07, 0.1, 5.4, 6); pole.translate(0, 2.7, 0);
  const head = new THREE.BoxGeometry(0.5, 0.25, 0.5); head.translate(0, 5.35, 0);
  LAMP_GEO = mergeGeos([pole, head]); LAMP_MAT = new THREE.MeshLambertMaterial({ color: 0x2f3437 });
  TRUNK_GEO = new THREE.CylinderGeometry(0.18, 0.28, 3.2, 6); TRUNK_GEO.translate(0, 1.6, 0); TRUNK_MAT = new THREE.MeshLambertMaterial({ color: 0x4b3a2c });
  CROWN_GEO = new THREE.IcosahedronGeometry(2.6, 0); CROWN_GEO.translate(0, 5, 0); CROWN_MAT = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  GLOWMAT = new THREE.PointsMaterial({ map: GLOW_TEX, size: 7, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
}
function mergeGeos(list) {
  const pos = [], nor = [];
  for (const g of list) { const ng = g.index ? g.toNonIndexed() : g; pos.push(...ng.attributes.position.array); nor.push(...ng.attributes.normal.array); }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); return out;
}

// ---- ground: blocks, parks, water, streets
function addRibbons(pos, col, pts, w, y, c) {
  for (let i = 1; i < pts.length; i++) {
    const [ax0, ay0] = pts[i - 1], [bx0, by0] = pts[i]; const dx = bx0 - ax0, dy = by0 - ay0, L = Math.hypot(dx, dy); if (L < 0.01) continue;
    const ux = dx / L, uy = dy / L, nx = -uy * w / 2, ny = ux * w / 2, ax = ax0 - ux * w / 2, ay = ay0 - uy * w / 2, bx = bx0 + ux * w / 2, by = by0 + uy * w / 2;
    pos.push(ax + nx, y, ay + ny, ax - nx, y, ay - ny, bx - nx, y, by - ny, ax + nx, y, ay + ny, bx - nx, y, by - ny, bx + nx, y, by + ny);
    for (let k = 0; k < 6; k++) col.push(...c);
  }
}
function addPolys(pos, col, rings, y, c) {
  for (const r of rings) {
    const v2 = []; for (let i = 0; i < r.length; i += 2) v2.push(new THREE.Vector2(r[i], r[i + 1]));
    if (v2.length < 3) continue; let tris = []; try { tris = THREE.ShapeUtils.triangulateShape(v2, []); } catch (e) {}
    for (const tri of tris) for (const k of tri) { pos.push(v2[k].x, y, v2[k].y); col.push(...c); }
  }
}
function flatMesh(pos, col, mat) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const nor = new Float32Array(pos.length); for (let i = 1; i < nor.length; i += 3) nor[i] = 1; g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return new THREE.Mesh(g, mat);
}
function buildGround() {
  const pos = [], col = [];
  const pad = 3000; addPolys(pos, col, [[BX0 - pad, BY0 - pad, BX1 + pad, BY0 - pad, BX1 + pad, BY1 + pad, BX0 - pad, BY1 + pad]], -0.3, [0.55, 0.55, 0.54]);
  addPolys(pos, col, [[BX0, BY0, BX1, BY0, BX1, BY1, BX0, BY1]], 0, [0.74, 0.72, 0.69]); // pavement
  addPolys(pos, col, M.parks, 0.04, [0.42, 0.52, 0.34]);
  addPolys(pos, col, M.water, 0.08, [0.30, 0.42, 0.52]);
  for (const [, r] of M.rivers) { const pts = []; for (let i = 0; i < r.length; i += 2) pts.push([r[i], r[i + 1]]); addRibbons(pos, col, pts, 22, 0.08, [0.30, 0.42, 0.52]); }
  const SCOL = [[0.33, 0.34, 0.36], [0.35, 0.36, 0.38], [0.37, 0.38, 0.40], [0.39, 0.40, 0.42], [0.42, 0.43, 0.45], [0.66, 0.62, 0.56]];
  for (const w of ways) addRibbons(pos, col, w.p.map(n => [NX[n], NY[n]]), SWID[w.c], 0.16, SCOL[w.c]);
  // centre lines on bigger streets
  for (const w of ways) if (w.c <= 2) addRibbons(pos, col, w.p.map(n => [NX[n], NY[n]]), 0.25, 0.18, [0.82, 0.82, 0.78]);
  GMAT = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  SC.add(flatMesh(pos, col, GMAT));
}

// ---- landmarks, markets, signs, the goal beacon
function buildTVTower() {
  const [x, y] = proj(52.52082, 13.40940), grp = new THREE.Group(), m = new THREE.MeshLambertMaterial({ color: 0xd9dce1 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(5, 16, 205, 20), m); shaft.position.y = 102.5; grp.add(shaft);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(16, 24, 16), new THREE.MeshLambertMaterial({ color: 0xc4cad3 })); ball.position.y = 212; grp.add(ball);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 5, 22, 12), m); top.position.y = 236; grp.add(top);
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(1, 2.4, 120, 8), new THREE.MeshLambertMaterial({ color: 0xc9473a })); ant.position.y = 307; grp.add(ant);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(3, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3b30, fog: false })); lamp.position.y = 368; grp.add(lamp);
  grp.traverse(o => { if (o.material && o !== lamp) o.material.fog = false; }); // stays visible above the haze: a landmark to steer by
  grp.position.set(x, 0, y); SC.add(grp);
}
function buildMarkets() {
  const stallGeo = mergeGeos([new THREE.BoxGeometry(3, 2.4, 2.4).translate(0, 1.2, 0), new THREE.ConeGeometry(2.3, 1.3, 4).rotateY(Math.PI / 4).translate(0, 3.05, 0)]);
  const stallMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const lightMat = new THREE.PointsMaterial({ size: 0.9, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const STALLS = [0x7a4b2a, 0x8e5a32, 0x6b3f22, 0x9b2f2a, 0x2f5d3a];
  for (const p of PLACES) { if (p.cat !== 'market' || !p.onMap) continue;
    const spots = [], rnd = rand(p.id.charCodeAt(0) * 31 + (p.id.charCodeAt(1) || 7));
    for (let ring = 0; ring < 3; ring++) { const R = 9 + ring * 8, n = 6 + ring * 5;
      for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2 + ring * 0.3, x = p.x + Math.cos(a) * R, y = p.y + Math.sin(a) * R;
        if (!inBuilding(x, y) && !inBuilding(x + 2, y) && !inBuilding(x - 2, y)) spots.push([x, y, a]); } }
    const grp = new THREE.Group();
    const stalls = new THREE.InstancedMesh(stallGeo, stallMat, Math.max(1, spots.length));
    spots.forEach(([x, y, a], i) => { _m4.makeRotationY(-a + Math.PI / 2).setPosition(x, 0, y); stalls.setMatrixAt(i, _m4); stalls.setColorAt(i, _col.setHex(STALLS[Math.floor(rnd() * STALLS.length)])); });
    grp.add(stalls);
    // string lights looping between stalls
    const lp = [], lc = [], bulbs = [[1, .82, .45], [1, .55, .35], [1, .95, .7], [.9, .3, .25], [.55, .8, 1]];
    for (let i = 0; i < spots.length; i++) { const [ax, ay] = spots[i], [bx, by] = spots[(i + 1) % spots.length]; if (Math.hypot(bx - ax, by - ay) > 14) continue;
      for (let k = 0; k <= 8; k++) { const f = k / 8; lp.push(ax + (bx - ax) * f, 3.6 - Math.sin(f * Math.PI) * 0.7, ay + (by - ay) * f); lc.push(...bulbs[(i + k) % bulbs.length]); } }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); lg.setAttribute('color', new THREE.Float32BufferAttribute(lc, 3));
    const lights = new THREE.Points(lg, lightMat); grp.add(lights);
    // a Christmas tree in the middle
    const tm = new THREE.MeshLambertMaterial({ color: 0x24522f, flatShading: true });
    for (let k = 0; k < 4; k++) { const cone = new THREE.Mesh(new THREE.ConeGeometry(4.2 - k * 0.9, 4, 8), tm); cone.position.set(p.x, 2.5 + k * 2.4, p.y); grp.add(cone); }
    const star = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0xffe08a, blending: THREE.AdditiveBlending, depthWrite: false })); star.position.set(p.x, 13, p.y); star.scale.set(4, 4, 1); grp.add(star);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); glow.position.set(p.x, 6, p.y); glow.scale.set(70, 26, 1); grp.add(glow);
    SC.add(grp); MARKET_PARTS.push({ p, lights, glow, star });
  }
}
function buildSigns() {
  const font = getComputedStyle(document.body).getPropertyValue('--display');
  for (const p of PLACES) { if (!p.onMap) continue;
    const s = labelSprite((g, w, h) => { g.fillStyle = 'rgba(21,28,42,.88)'; g.beginPath(); g.roundRect(0, 0, w, h, 18); g.fill();
      g.fillStyle = CATCOLOR[p.cat]; g.beginPath(); g.arc(h / 2, h / 2, h / 2 - 10, 0, 7); g.fill(); g.fillStyle = '#fff'; g.font = `700 ${h * 0.42}px ${font}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(p.id, h / 2, h / 2 + 2);
      g.textAlign = 'left'; g.font = `600 ${h * 0.4}px ${font}`; g.fillText(p.name, h + 4, h / 2 + 2); }, 640, 96, 3.2);
    s.position.set(p.x, 9, p.y); s.material.fog = true; SC.add(s); PLACE_SPRITES.push({ s, p });
  }
  for (const st of Object.values(ST)) { if (!st.onMap) continue; const kinds = stKinds(st);
    const s = labelSprite((g, w, h) => { let x = 8; for (const k of kinds) { g.fillStyle = k === 'U' ? '#1f5fae' : '#3a8a3c'; g.beginPath(); if (k === 'U') g.roundRect(x, 8, h - 16, h - 16, 8); else g.arc(x + (h - 16) / 2, h / 2, (h - 16) / 2, 0, 7); g.fill();
        g.fillStyle = '#fff'; g.font = `700 ${h * 0.55}px ${font}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(k, x + (h - 16) / 2, h / 2 + 3); x += h - 8; }
      g.fillStyle = 'rgba(255,255,255,.95)'; g.beginPath(); g.roundRect(x, 10, w - x - 6, h - 20, 8); g.fill(); g.fillStyle = '#111'; g.font = `600 ${h * 0.42}px ${font}`; g.textAlign = 'left'; g.fillText(st.name, x + 10, h / 2 + 2); }, 640, 80, 1.9);
    s.position.set(st.x, 3.6, st.y); SC.add(s); STATION_SPRITES.push({ s, st });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), LAMP_MAT); pole.position.set(st.x, 1.3, st.y); SC.add(pole);
  }
  BEACON = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 260, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xf3c22f, transparent: true, opacity: 0.28, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  BEACON.position.y = 130; BEACON.visible = false; SC.add(BEACON);
}
// corner signs: Berlin-style street plates at the nearest junctions ahead
const CORNER = []; let cornerKey = '';
function updateCorners() {
  const fx = Math.cos(FP.yaw), fy = Math.sin(FP.yaw), cand = [];
  const cx = Math.floor(P.x / SCELL), cy = Math.floor(P.y / SCELL), seen = new Set();
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) for (const s of SGRID.get((cx + i) + ',' + (cy + j)) || []) {
    for (const [x, y] of [[s.ax, s.ay], [s.bx, s.by]]) { const dx = x - P.x, dy = y - P.y, d = Math.hypot(dx, dy); if (d < 8 || d > 110 || (dx * fx + dy * fy) / d < 0.2 || !s.name) continue;
      const key = s.name + '@' + Math.round(x / 15) + ',' + Math.round(y / 15); if (seen.has(key)) continue; seen.add(key); cand.push({ x, y, d, name: s.name }); } }
  cand.sort((a, b) => a.d - b.d);
  const byNode = new Map(); for (const c of cand) { const k = Math.round(c.x) + ',' + Math.round(c.y); if (!byNode.has(k)) byNode.set(k, []); const l = byNode.get(k); if (!l.includes(c.name)) l.push(c.name); }
  const picks = [...byNode.entries()].filter(([, names]) => names.length >= 2).slice(0, 3);
  const key = picks.map(p => p[0] + p[1].join('|')).join(';'); if (key === cornerKey) return; cornerKey = key;
  for (const s of CORNER) SC.remove(s.obj); CORNER.length = 0;
  const font = getComputedStyle(document.body).getPropertyValue('--display');
  for (const [k, names] of picks) { const [x, y] = k.split(',').map(Number);
    const sp = labelSprite((g, w, h) => { names.slice(0, 2).forEach((nm, i) => { const y0 = i * (h / 2); g.fillStyle = '#fbfbf7'; g.fillRect(4, y0 + 4, w - 8, h / 2 - 8); g.strokeStyle = '#111'; g.lineWidth = 5; g.strokeRect(12, y0 + 12, w - 24, h / 2 - 24);
      g.fillStyle = '#111'; g.font = `600 ${h * 0.2}px ${font}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(nm, w / 2, y0 + h / 4 + 2); }); }, 512, 200, 1.5);
    sp.position.set(x + 3, 3.4, y + 3); SC.add(sp); CORNER.push({ obj: sp }); }
}
function setHintPath(polys) {
  if (HINTMESH) { SC.remove(HINTMESH); HINTMESH = null; }
  if (!polys || !FP.inited) return;
  const pos = [], col = []; for (const poly of polys) addRibbons(pos, col, poly.map(([x, y]) => [x, y]), 2.2, 0.3, [1, 0.8, 0.2]);
  HINTMESH = flatMesh(pos, col, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide })); SC.add(HINTMESH);
}

function init3D() {
  if (FP.inited) return true;
  if (!FP.ok) return false;
  try {
    R3 = new THREE.WebGLRenderer({ canvas: glEl, antialias: true });
    R3.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    SC = new THREE.Scene(); SC.fog = new THREE.Fog(0xc4cbd4, 90, 620);
    CAM = new THREE.PerspectiveCamera(68, 1, 0.3, 2000);
    HEMI = new THREE.HemisphereLight(0xe6ebf2, 0x6a6660, 0.95); SC.add(HEMI);
    SUN = new THREE.DirectionalLight(0xfff0d8, 0.5); SUN.position.set(-0.45, 0.3, 0.84); SC.add(SUN); // low November sun from the south-southwest
    makeTextures(); sharedGeometry();
    BMAT = new THREE.MeshLambertMaterial({ vertexColors: true, map: FACADE_TEX, emissiveMap: WINDOW_TEX, emissive: 0x000000 });
    decodeBuildings(); buildStreetGrid(); buildGround(); buildTVTower(); buildMarkets(); buildSigns();
    FP.inited = true; return true;
  } catch (e) { FP.ok = false; console.warn('3D view unavailable', e); return false; }
}
let lightKey = '';
function light3D() {
  const dk = Math.round(darkness() * 40) / 40;
  for (const m of MARKET_PARTS) { const open = marketOpen(m.p); m.lights.visible = open; m.glow.visible = open && dk > 0.3; m.star.visible = open || dk < 0.3; }
  if (lightKey === dk + '' + S.rain) return; lightKey = dk + '' + S.rain;
  const sky = new THREE.Color(mix(S.rain ? [172, 180, 190] : [192, 199, 208], [16, 20, 34], dk));
  SC.background = sky; SC.fog.color = sky; SC.fog.near = S.rain ? 50 : 90; SC.fog.far = (S.rain ? 420 : 620) - dk * 120;
  HEMI.intensity = 0.95 - 0.55 * dk; SUN.intensity = 0.5 * (1 - dk); HEMI.color.set(dk > 0.5 ? 0xb8c4e0 : 0xe6ebf2);
  BMAT.emissive.setRGB(dk, dk * 0.92, dk * 0.8); GMAT.color.setRGB(1 - 0.25 * dk, 1 - 0.22 * dk, 1 - 0.12 * dk); GMAT.emissive.setRGB(0.06 * dk, 0.06 * dk, 0.075 * dk); GLOWMAT.opacity = Math.min(1, dk * 1.3);
}
function renderFP(dt) {
  const w = glEl.clientWidth, h = glEl.clientHeight;
  if (glEl.width !== Math.round(w * R3.getPixelRatio()) || glEl.height !== Math.round(h * R3.getPixelRatio())) { R3.setSize(w, h, false); CAM.aspect = w / h; CAM.updateProjectionMatrix(); }
  const fx = Math.cos(FP.yaw), fy = Math.sin(FP.yaw), eye = 1.65 + (reduceMotion ? 0 : Math.sin(FP.bob) * 0.045);
  CAM.position.set(P.x, eye, P.y);
  CAM.lookAt(P.x + fx * 10, eye + Math.tan(FP.pitch) * 10, P.y + fy * 10);
  for (const t of BLD_TILES.values()) { const d = DIST(t.cx, t.cy, P.x, P.y);
    if (!t.group && d < 900 && !FP.builtThisFrame) { buildTile(t); FP.builtThisFrame = true; }
    if (t.group) t.group.visible = d < 1000; }
  FP.builtThisFrame = false;
  const goals = S.mission ? new Set(S.mission.goal.filter(g => !S.visited.has(g))) : new Set();
  for (const { s, p } of PLACE_SPRITES) { const d = DIST(p.x, p.y, P.x, P.y); s.visible = d < 260 || (goals.has(p.id) && d < 900); }
  for (const { s, st } of STATION_SPRITES) s.visible = DIST(st.x, st.y, P.x, P.y) < 320;
  const g = nextGoal(); BEACON.visible = !!(g && g.onMap); if (g && g.onMap) BEACON.position.set(g.x, 130, g.y);
  light3D();
  R3.render(SC, CAM);
}

// ---- input: controller (Razer Kishi = standard gamepad), keyboard, touch
const PADPREV = {};
const keys = new Set();
window.addEventListener('keydown', e => { if (!FP.on) return; keys.add(e.key.toLowerCase());
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(e.key.toLowerCase()) && uiOpen() === false) e.preventDefault();
  const k = e.key.toLowerCase();
  if (k === 'e' || k === 'enter') { if (!uiOpen()) interact(); }
  if (k === 'm') toggleMap(); if (k === 'h') clickIf('hintBtn'); if (k === 'escape') backAction(); });
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
window.addEventListener('gamepadconnected', () => { FP.pad = true; document.getElementById('app').classList.add('pad'); toast('Controller connected. Left stick walks, right stick looks.'); });
window.addEventListener('gamepaddisconnected', () => { FP.pad = false; document.getElementById('app').classList.remove('pad'); });
const uiOpen = () => !ov.hidden || !sheetEl.hidden;
function clickIf(id) { const b = document.getElementById(id); if (b && b.offsetParent !== null) { b.click(); return true; } return false; }
function backAction() {
  if (!ov.hidden) { clickIf('back') || clickIf('resume'); return; }
  if (!sheetEl.hidden) { for (const id of ['cardOk', 'hintOk', 'cafeOk', 'leaveSt', 'go', 'sceneBack', 'toMenu']) if (clickIf(id)) return; }
}
function focusables() { const root = !ov.hidden ? ov : sheetEl; return [...root.querySelectorAll('button')].filter(b => !b.disabled && b.offsetParent !== null); }
function moveFocus(d) { const f = focusables(); if (!f.length) return; let i = f.indexOf(document.activeElement); i = i < 0 ? 0 : (i + d + f.length) % f.length; f[i].focus(); f[i].scrollIntoView({ block: 'nearest' }); }
function pollPad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : []; let gp = null; for (const p of pads) if (p && p.connected) { gp = p; break; }
  if (!gp) return null;
  if (!FP.pad) { FP.pad = true; document.getElementById('app').classList.add('pad'); }
  const pressed = i => !!(gp.buttons[i] && gp.buttons[i].pressed), edge = i => { const now = pressed(i), was = PADPREV[i]; PADPREV[i] = now; return now && !was; };
  const dz = v => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
  const st = { mx: dz(gp.axes[0] || 0), my: dz(gp.axes[1] || 0), lx: dz(gp.axes[2] || 0), ly: dz(gp.axes[3] || 0), run: pressed(7) || pressed(10) || pressed(5) };
  const ui = uiOpen();
  if (edge(0)) { if (ui) { const a = document.activeElement; if (a && a.tagName === 'BUTTON' && (sheetEl.contains(a) || ov.contains(a))) a.click(); else { const f = focusables(); if (f[0]) f[0].click(); } } else interact(); }
  if (edge(1)) backAction();
  if (edge(2)) clickIf('hintBtn');
  if (edge(3) || edge(8)) toggleMap();
  if (edge(9)) { if (ov.hidden) openMenu(); else clickIf('resume'); }
  const up = edge(12), down = edge(13), left = edge(14), right = edge(15);
  if (ui) { if (up || left) moveFocus(-1); if (down || right) moveFocus(1);
    const ay = st.my; if (Math.abs(ay) > 0.6 && !FP.stickNav) { moveFocus(ay > 0 ? 1 : -1); FP.stickNav = true; } else if (Math.abs(ay) < 0.3) FP.stickNav = false; }
  return st;
}
// touch: left thumb pad walks, dragging elsewhere looks around
const stickEl = document.getElementById('stick'), knobEl = stickEl ? stickEl.querySelector('i') : null; let stickId = null, lookId = null, lookLast = null;
glEl.addEventListener('pointerdown', e => {
  glEl.setPointerCapture(e.pointerId);
  const r = glEl.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  if (x < r.width * 0.45 && y > r.height * 0.45 && stickId === null && e.pointerType !== 'mouse') { stickId = e.pointerId; FP.stickOrigin = [e.clientX, e.clientY]; if (stickEl) { stickEl.style.left = (e.clientX - 55) + 'px'; stickEl.style.top = (e.clientY - 55) + 'px'; stickEl.classList.add('active'); } }
  else { lookId = e.pointerId; lookLast = [e.clientX, e.clientY]; }
});
glEl.addEventListener('pointermove', e => {
  if (e.pointerId === stickId) { const dx = e.clientX - FP.stickOrigin[0], dy = e.clientY - FP.stickOrigin[1], L = Math.min(45, Math.hypot(dx, dy)) / 45, a = Math.atan2(dy, dx);
    FP.moveX = Math.cos(a) * L; FP.moveY = Math.sin(a) * L; if (knobEl) knobEl.style.transform = `translate(${Math.cos(a) * L * 40}px, ${Math.sin(a) * L * 40}px)`; }
  else if (e.pointerId === lookId && lookLast) { FP.yaw += (e.clientX - lookLast[0]) * 0.006; FP.pitch = Math.max(-0.7, Math.min(0.5, FP.pitch - (e.clientY - lookLast[1]) * 0.004)); lookLast = [e.clientX, e.clientY]; }
});
const endTouch = e => { if (e.pointerId === stickId) { stickId = null; FP.moveX = FP.moveY = 0; if (knobEl) knobEl.style.transform = ''; if (stickEl) stickEl.classList.remove('active'); } if (e.pointerId === lookId) { lookId = null; lookLast = null; } };
glEl.addEventListener('pointerup', endTouch); glEl.addEventListener('pointercancel', endTouch);

let promptT = 0, streetT = 0;
function stepFP(dt) {
  const pad = pollPad();
  if (uiOpen()) { FP.moving = false; return; }
  let mx = FP.moveX, my = FP.moveY, lx = 0, ly = 0, run = false;
  if (pad) { if (Math.hypot(pad.mx, pad.my) > Math.hypot(mx, my)) { mx = pad.mx; my = pad.my; } lx = pad.lx; ly = pad.ly; run = pad.run; }
  if (keys.has('w') || keys.has('arrowup')) my = -1; if (keys.has('s') || keys.has('arrowdown')) my = 1;
  if (keys.has('a')) mx = -1; if (keys.has('d')) mx = 1; if (keys.has('arrowleft')) lx = -0.8; if (keys.has('arrowright')) lx = 0.8; if (keys.has('shift')) run = true;
  FP.yaw += lx * dt * 2.4; FP.pitch = Math.max(-0.7, Math.min(0.5, FP.pitch - ly * dt * 1.6));
  const mag = Math.min(1, Math.hypot(mx, my));
  if (mag > 0.05) {
    if (P.path) { P.path = null; P.onArrive = null; } // taking the stick back from auto-walk
    const speed = (run ? 11 : 5.5) * mag, fx = Math.cos(FP.yaw), fy = Math.sin(FP.yaw);
    const vx = (fx * -my + -fy * mx) / Math.max(1, Math.hypot(mx, my)) * speed * dt, vy = (fy * -my + fx * mx) / Math.max(1, Math.hypot(mx, my)) * speed * dt;
    const nx = P.x + vx, ny = P.y + vy, ahead = 0.45 / Math.max(0.001, Math.hypot(vx, vy));
    let moved = 0; const stuck = inBuilding(P.x, P.y); // never trap anyone inside a building
    if (stuck || !blocked(nx + vx * ahead, ny + vy * ahead)) { P.x = nx; P.y = ny; moved = Math.hypot(vx, vy); }
    else if (!blocked(P.x + vx + Math.sign(vx) * 0.45, P.y)) { P.x += vx; moved = Math.abs(vx); }
    else if (!blocked(P.x, P.y + vy + Math.sign(vy) * 0.45)) { P.y += vy; moved = Math.abs(vy); }
    if (moved) { FP.bob += moved * 1.6; walkedMeters(moved); if (!save.words['zu Fuß']) learn('zu Fuß'); P.at = { kind: 'street', node: P.at.node }; FP.dirtyNode = true; }
    FP.moving = true;
  } else FP.moving = false;
  if (P.path) { const n = P.path[P.pathI + 1]; if (n !== undefined && DIST(P.x, P.y, NX[n], NY[n]) > 0.5) { const want = Math.atan2(NY[n] - P.y, NX[n] - P.x); let d = want - FP.yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; FP.yaw += d * Math.min(1, dt * 3); } FP.bob += dt * 8; }
  promptT -= dt; if (promptT <= 0) { promptT = 0.2; updatePrompt(); }
  streetT -= dt; if (streetT <= 0) { streetT = 0.4; updateStreetHere(); updateCorners(); }
}
function updateStreetHere() {
  const ns = nearestStreet(P.x, P.y); if (!ns || ns.d > ns.seg.w / 2 + 12 || !ns.seg.name) return;
  const nm = ns.seg.name; if (nm === P.street) return; P.street = nm; showStreetSign(nm);
  const low = nm.toLowerCase(); for (const [suf, w] of STREET_WORDS) if (low.endsWith(suf) || low.includes(suf + ' ')) { learn(w); break; }
}
const promptEl = document.getElementById('prompt');
function updatePrompt() {
  let best = null;
  for (const s of Object.values(ST)) if (s.onMap) { const d = DIST(P.x, P.y, s.x, s.y); if (d < 28 && (!best || d < best.d)) best = { d, kind: 'station', s }; }
  if (!best) for (const p of PLACES) if (p.onMap) { const d = DIST(P.x, P.y, p.x, p.y); if (d < 40 && (!best || d < best.d)) best = { d, kind: 'place', p }; }
  FP.prompt = best;
  if (!promptEl) return;
  if (!best || uiOpen()) { promptEl.hidden = true; return; }
  const label = best.kind === 'station' ? `Go down to ${stKinds(best.s).join('+')} ${best.s.name}` : `Look at ${best.p.name}`;
  promptEl.innerHTML = `<span class="btnA">A</span>${esc(label)}`; promptEl.hidden = false;
}
function interact() {
  const pr = FP.prompt; if (!pr) return;
  if (promptEl) promptEl.hidden = true;
  if (pr.kind === 'station') { P.at = { kind: 'street', node: pr.s.node }; enterStation(pr.s.name); }
  else { visit(pr.p, false); showPlaceCard(pr.p, true); }
}
if (promptEl) promptEl.onclick = () => interact();
