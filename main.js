// inVectus website. The hero map reuses the desktop app's drawing rules (src/DataCircle.tsx):
// items are small squares that merge into larger ones where they touch, clipped to a circle
// with a 1 px rim; squares flicker in (src/dot-flicker.ts); placeholders glide to their mapped
// positions after indexing. The data is the real Ophthalmology Research map (5,000 PubMed
// papers), compacted by scripts/build_map_data.py.

// Colours come from the hero's CSS tokens, so the map follows its (light) theme.
let INK = "#d1cbc2", ACCENT = "#6edcaa", BG = "#141414", INK_RGB = "209, 203, 194";
const LABEL_FONT = `500 9.5px "Martian Mono Variable", ui-monospace, monospace`;
const white = (a) => `rgba(${INK_RGB}, ${a})`;
const SINGLE = 4, MERGED_MAX = 11, PLACEHOLDERS = 1400;
const INDEX_MS = 1700, GLIDE_MS = 1100;
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- Motion: Angrove's relaxed spring as a CSS linear() curve (src/motion.ts) ---------- */
(function installMotion(root = document.documentElement) {
  const k = (2 * Math.PI / 0.5) ** 2, c = 2 * 0.8 * Math.sqrt(k), h = 1 / 240;
  let v = 0, vel = 0, t = 0;
  const s = [[0, 0]];
  while (t < 2) {
    for (let i = 0; i < 4; i++) { const a = -k * (v - 1) - c * vel; vel += a * h; v += vel * h; t += h; }
    s.push([t, v]);
    if (t > 0.3 && Math.abs(v - 1) < 0.001 && Math.abs(vel) < 0.01) break;
  }
  const end = s[s.length - 1][0];
  s[s.length - 1][1] = 1;
  const curve = `linear(${s.filter((_, i) => i % 3 === 0 || i === s.length - 1)
    .map(([tt, vv]) => `${vv.toFixed(4)} ${((tt / end) * 100).toFixed(2)}%`).join(", ")})`;
  if (CSS.supports("animation-timing-function", "linear(0, 1)")) root.style.setProperty("--spring-relaxed", curve);
  root.style.setProperty("--spring-relaxed-duration", `${Math.round(end * 1000)}ms`);
})();

/* ---------- Dot flicker (src/dot-flicker.ts) ---------- */
const DOT_DELAY_MS = 250, DOT_FLICKER_MS = 150, LEVELS = [1, 0.2, 0.85, 0.35, 0.7, 0.5];
class DotFlicker {
  starts = new Map(); until = 0;
  sync(keys, now) {
    const next = new Map(); this.until = 0;
    for (const key of keys) {
      const start = this.starts.get(key) ?? now + Math.random() * DOT_DELAY_MS;
      next.set(key, start); this.until = Math.max(this.until, start + DOT_FLICKER_MS);
    }
    this.starts = next;
  }
  opacity(key, now) {
    const start = this.starts.get(key);
    if (reduced || start === undefined || now >= start + DOT_FLICKER_MS) return 1;
    if (now < start) return 0;
    return LEVELS[Math.floor((now - start) / DOT_FLICKER_MS * LEVELS.length)];
  }
  pending(now) { return now < this.until; }
}

/* ---------- Merging squares (src/DataCircle.tsx) ---------- */
const side = (n) => (n === 1 ? SINGLE : Math.min(MERGED_MAX, SINGLE + 1.3 * Math.log2(n)));
function mergeTouching(cells) {
  let groups = cells;
  for (let pass = 0; pass < 6; pass++) {
    const bucket = MERGED_MAX + 2, hash = new Map();
    groups.forEach((c, i) => { const k = `${Math.floor(c.x / bucket)},${Math.floor(c.y / bucket)}`; (hash.get(k) ?? hash.set(k, []).get(k)).push(i); });
    const parent = groups.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    let merged = false;
    groups.forEach((a, i) => {
      const bx = Math.floor(a.x / bucket), by = Math.floor(a.y / bucket);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const j of hash.get(`${bx + dx},${by + dy}`) ?? []) {
        if (j <= i) continue;
        const b = groups[j], reach = (side(a.n) + side(b.n)) / 2 + 1;
        if (Math.abs(a.x - b.x) < reach && Math.abs(a.y - b.y) < reach) { const ra = find(i), rb = find(j); if (ra !== rb) { parent[rb] = ra; merged = true; } }
      }
    });
    if (!merged) break;
    const joined = new Map();
    groups.forEach((c, i) => {
      const r = find(i), t = joined.get(r);
      if (!t) { joined.set(r, { ...c, x: c.x * c.n, y: c.y * c.n, regions: new Map(c.regions) }); return; }
      t.x += c.x * c.n; t.y += c.y * c.n; t.n += c.n;
      c.regions.forEach((v, k) => t.regions.set(k, (t.regions.get(k) ?? 0) + v));
    });
    groups = [...joined.values()].map((c) => ({ ...c, x: c.x / c.n, y: c.y / c.n }));
  }
  return groups;
}
function disc(i) { // placeholder positions in the visible quadrant
  const a = Math.sin(i * 12.9898) * 43758.5453, b = Math.sin(i * 78.233) * 12345.6789;
  const r = Math.sqrt(a - Math.floor(a)) * 0.95, t = Math.PI + (b - Math.floor(b)) * Math.PI / 2;
  return [Math.cos(t) * r, Math.sin(t) * r];
}

/* ---------- Hero map: the real Ophthalmology Research map, explorable like the app ---------- */
const KIND_LABEL = { coverage: "Coverage gap", stale: "Stale coverage", bridge: "Bridge" };
const ROLE_LABEL = { d: "Demand", c: "Coverage", n: "Neutral" };
const ZOOM_MIN = 0.6, ZOOM_MAX = 200, ZOOM_PER_DELTA = 0.012, PINCH_DAMPING = 0.72;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (n) => n.toLocaleString("en-US");
const HERO_CELL = 6, START_ZOOM = 1.9;
const heroSide = (n) => (n === 1 ? SINGLE : Math.min(HERO_CELL - 1, SINGLE + 0.6 * Math.log2(n)));

function heroMap() {
  const D = window.INVECTUS_MAP;
  const hero = document.querySelector(".hero");
  if (!D || !hero) return;
  const canvas = hero.querySelector(".hero-map");
  const tip = hero.querySelector(".hero-tip");
  const status = hero.querySelector(".status");
  const statusText = status.querySelector(".status-text");
  const g = canvas.getContext("2d");
  const css = getComputedStyle(hero), token = (n) => css.getPropertyValue(n).trim();
  INK = token("--ink") || INK; ACCENT = token("--accent") || ACCENT; BG = token("--bg") || BG; INK_RGB = token("--ink-rgb") || INK_RGB;

  const points = D.points.map(([x, y, fine, role, year, t], i) => ({ i, x, y, fine, role, year, title: D.titles[t] }));
  const regions = new Map(D.regions.map((r) => [r.id, r]));
  const gaps = D.gaps.map((gp, rank) => {
    const a = regions.get(gp.a), b = gp.b === null ? undefined : regions.get(gp.b);
    const area = b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, radius: Math.hypot(a.x - b.x, a.y - b.y) / 2 + Math.max(a.radius, b.radius) } : a;
    return { ...gp, code: `G-${String(rank + 1).padStart(2, "0")}`, x: area.x, y: area.y, area };
  });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const fit = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, extent: Math.max(x1 - x0, y1 - y0), k: 1 };

  const flicker = new DotFlicker();
  let W = 0, H = 0, R = 0, A = { x: 0, y: 0 }, cells = [], frame = 0, zoomFrame;
  let view = { s: START_ZOOM, x: 0, y: 0 }, hover, pinned, drag, pinch;
  const t0 = performance.now();
  let phase = "done", laidOut = false, introTimer, introOver = false;

  const toScreen = (x, y) => [A.x + (x - fit.cx) * fit.k * view.s + view.x, A.y + (y - fit.cy) * fit.k * view.s + view.y];
  const inside = (x, y, pad = 0) => (x - W) ** 2 + (y - H) ** 2 <= (R - pad) ** 2;
  const regionName = (id) => regions.get(id)?.label ?? "";

  function layout() {
    const rect = hero.getBoundingClientRect();
    W = rect.width; H = rect.height;
    // Keep the copy clear: the rim stays at least 28 px from the nearest corner of the text.
    const box = [...hero.querySelectorAll(".hero-copy > *")].map((el) => el.getBoundingClientRect())
      .reduce((a, b) => ({ right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) }), { right: 0, bottom: 0 });
    const clear = Math.hypot(Math.max(0, W - (box.right - rect.left)), Math.max(0, H - (box.bottom - rect.top))) - 28;
    R = Math.max(Math.hypot(W, H) * 0.3, Math.min(Math.hypot(W, H) * 0.56, clear));
    // The data sits in the visible quadrant of the circle, centred on it.
    A = { x: W - R * 0.5, y: H - R * 0.5 };
    fit.k = (R * 0.86) / fit.extent;
    if (!laidOut) { view = { s: START_ZOOM, x: 0, y: 0 }; laidOut = true; }
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    rebuild();
    if (pinned) placeCard();
  }

  // Group items in a screen grid, one square per occupied cell. The app also merges squares
  // that touch; on this dense real map that collapses everything into a few dozen blocks, so
  // the hero keeps the grid and lets zooming split clusters instead.
  function rebuild() {
    const CELL = HERO_CELL, cols = Math.ceil(W / CELL) + 2, grid = new Map();
    for (const p of points) {
      const [x, y] = toScreen(p.x, p.y);
      if (x < -12 || y < -12 || x > W + 12 || y > H + 12 || !inside(x, y, -6)) continue;
      const k = Math.floor(y / CELL) * cols + Math.floor(x / CELL), c = grid.get(k);
      if (c) { c.x += x; c.y += y; c.n++; c.regions.set(p.fine, (c.regions.get(p.fine) ?? 0) + 1); }
      else grid.set(k, { x, y, n: 1, first: p, regions: new Map([[p.fine, 1]]) });
    }
    cells = [...grid.values()].map((c) => ({ ...c, x: c.x / c.n, y: c.y / c.n, key: `item:${c.first.i}` }));
    syncFlicker();
    draw();
  }

  function visibleGaps() {
    return gaps.filter((gp) => { const [x, y] = toScreen(gp.x, gp.y); return x > 0 && y > 0 && inside(x, y, 7); });
  }
  function syncFlicker(now = performance.now()) {
    const keys = [];
    if (phase !== "done") for (let i = 0; i < PLACEHOLDERS; i++) keys.push(`ph:${i}`);
    else {
      for (const c of cells) keys.push(c.key);
      for (const gp of visibleGaps()) keys.push(`gap:${gp.code}`);
      if (pinned?.point) keys.push(`mark:${pinned.point.i}`);
    }
    flicker.sync(keys, now);
  }
  const majority = (c) => [...c.regions.entries()].sort((a, b) => b[1] - a[1])[0][0];

  function draw() {
    cancelAnimationFrame(frame);
    const now = performance.now(), el = now - t0;
    if (phase === "index" && el > INDEX_MS) phase = "glide";
    if (phase === "glide" && el > INDEX_MS + GLIDE_MS) { phase = "done"; syncFlicker(now); }
    const frac = phase === "index" ? Math.min(1, el / INDEX_MS) : 1;
    const glide = phase === "glide" ? (el - INDEX_MS) / GLIDE_MS : phase === "done" ? 1 : 0;

    g.clearRect(0, 0, W, H);
    g.save();
    g.beginPath(); g.arc(W, H, R - 1, 0, Math.PI * 2); g.clip();

    if (phase !== "done") {
      const ease = glide * glide * (3 - 2 * glide);
      g.fillStyle = INK;
      for (let i = 0; i < PLACEHOLDERS; i++) {
        const [ux, uy] = disc(i);
        let x = W + ux * R, y = H + uy * R;
        if (glide > 0 && cells.length) { const t = cells[(i * 7919) % cells.length]; x += (t.x - x) * ease; y += (t.y - y) * ease; }
        g.globalAlpha = (phase === "index" ? 0.55 : 0.55 * (1 - ease) + 0.2) * flicker.opacity(`ph:${i}`, now);
        g.fillRect(x - 2, y - 2, 4, 4);
      }
    } else {
      // Region outlines: hidden until hover, or the pinned gap's regions.
      const outlined = new Set();
      if (hover?.cell) outlined.add(majority(hover.cell));
      if (pinned?.point) outlined.add(pinned.point.fine);
      if (pinned?.gap) { outlined.add(pinned.gap.a); if (pinned.gap.b !== null) outlined.add(pinned.gap.b); }
      g.setLineDash([3, 4]); g.lineWidth = 1; g.strokeStyle = white(0.45);
      for (const id of outlined) {
        const r = regions.get(id); if (!r) continue;
        const [x, y] = toScreen(r.x, r.y);
        g.beginPath(); g.arc(x, y, Math.max(6, r.radius * fit.k * view.s), 0, Math.PI * 2); g.stroke();
      }
      g.setLineDash([]);

      g.fillStyle = INK;
      for (const c of cells) {
        const s = heroSide(c.n);
        g.globalAlpha = (c.n === 1 ? 0.62 : 0.88) * flicker.opacity(c.key, now);
        g.fillRect(c.x - s / 2, c.y - s / 2, s, s);
      }

      // Region names once a region is large enough on screen.
      g.font = LABEL_FONT; g.textBaseline = "middle"; g.textAlign = "center";
      for (const r of D.regions) {
        const rr = r.radius * fit.k * view.s;
        if (rr < 46) continue;
        const [x, y] = toScreen(r.x, r.y);
        if (!inside(x, y, 30) || x < 0 || y < 0 || x > W || y > H) continue;
        const text = r.label.split(" · ").slice(0, 2).join(" · ");
        const half = g.measureText(text).width / 2 + 4, ty = y - rr - 8;
        if (!inside(x - half, ty) || !inside(x + half, ty) || x - half < 0 || x + half > W) continue;
        g.globalAlpha = Math.min(1, (rr - 46) / 30);
        g.lineWidth = 3; g.strokeStyle = BG; g.strokeText(text, x, y - rr - 8);
        g.fillStyle = white(0.75); g.fillText(text, x, y - rr - 8);
      }
      g.textAlign = "left";

      // A pinned item: an accent × like the app's marked results.
      if (pinned?.point) {
        const [x, y] = toScreen(pinned.point.x, pinned.point.y);
        g.globalAlpha = flicker.opacity(`mark:${pinned.point.i}`, now);
        g.strokeStyle = ACCENT; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(x - 5, y - 5); g.lineTo(x + 5, y + 5); g.moveTo(x + 5, y - 5); g.lineTo(x - 5, y + 5); g.stroke();
      }

      // Gap marks: rings with codes; the pinned or hovered gap in the accent.
      for (const gp of visibleGaps()) {
        const [x, y] = toScreen(gp.x, gp.y);
        const selected = pinned?.gap === gp || hover?.gap === gp;
        g.globalAlpha = flicker.opacity(`gap:${gp.code}`, now);
        g.lineWidth = selected ? 2 : 1; g.strokeStyle = selected ? ACCENT : INK; g.fillStyle = BG;
        g.beginPath(); g.arc(x, y, 4.5, 0, Math.PI * 2); g.fill(); g.stroke();
        g.lineWidth = 3; g.strokeStyle = BG; g.strokeText(gp.code, x + 8, y);
        g.fillStyle = selected ? ACCENT : white(0.7); g.fillText(gp.code, x + 8, y);
      }
    }
    g.globalAlpha = 1;
    g.restore();

    g.strokeStyle = INK; g.lineWidth = 1;
    g.beginPath(); g.arc(W, H, R - 1, 0, Math.PI * 2); g.stroke();
    if (phase === "index") {
      g.lineWidth = 3;
      g.beginPath(); g.arc(W, H, R - 2, -Math.PI / 2, -Math.PI / 2 - frac * Math.PI / 2, true); g.stroke();
    }

    status.style.setProperty("--p", frac.toFixed(3));
    if (phase === "index") statusText.textContent = `Indexing… ${fmt(Math.round(frac * points.length))} / ${fmt(points.length)}`;
    else if (phase === "glide") statusText.textContent = "Mapping…";
    else { statusText.textContent = `Mapped · ${fmt(points.length)} papers · ${D.regions.length} regions · ${D.gap_count} gaps`; status.classList.add("done"); }

    if (phase !== "done" || flicker.pending(now)) frame = requestAnimationFrame(draw);
  }

  /* Camera, as in the app: geometric zoom anchored at the pointer, smoothstep easing. */
  const setView = (v) => { view = v; rebuild(); if (pinned) placeCard(); };
  const clampPan = (v) => { const lim = R * Math.max(1, v.s); return { s: v.s, x: Math.max(-lim, Math.min(lim, v.x)), y: Math.max(-lim, Math.min(lim, v.y)) }; };
  const zoomTo = (v, next, px, py) => {
    const s = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next)), k = s / v.s;
    return clampPan({ s, x: px - A.x - (px - A.x - v.x) * k, y: py - A.y - (py - A.y - v.y) * k });
  };
  const stopZoom = () => { if (zoomFrame) cancelAnimationFrame(zoomFrame); zoomFrame = undefined; };
  function animateTo(target, ms, done) {
    stopZoom();
    if (reduced) { setView(target); done?.(); return; }
    const start = view, started = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - started) / ms), e = p * p * (3 - 2 * p);
      const s = start.s * Math.pow(target.s / start.s, e);
      setView({ s, x: (start.x / start.s + (target.x / target.s - start.x / start.s) * e) * s, y: (start.y / start.s + (target.y / target.s - start.y / start.s) * e) * s });
      zoomFrame = p < 1 ? requestAnimationFrame(step) : undefined;
      if (p === 1) done?.();
    };
    zoomFrame = requestAnimationFrame(step);
  }
  const zoomAt = (f, px, py) => animateTo(zoomTo(view, view.s * f, px, py), 360);
  function focusArea(area, done) {
    const radius = Math.max(1, area.radius * fit.k);
    const s = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, R * 0.3 / radius));
    animateTo({ s, x: -(area.x - fit.cx) * fit.k * s, y: -(area.y - fit.cy) * fit.k * s }, done ? 1400 : 450, done);
  }

  /* Hit testing, tooltips and the pinned card. */
  const at = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  function find(x, y) {
    if (phase !== "done" || !inside(x, y)) return undefined;
    for (const gp of visibleGaps()) { const [gx, gy] = toScreen(gp.x, gp.y); if ((gx - x) ** 2 + (gy - y) ** 2 < 64) return { gap: gp }; }
    let best, bd = 100;
    for (const c of cells) { const d = (c.x - x) ** 2 + (c.y - y) ** 2; if (d < bd) { bd = d; best = c; } }
    return best ? { cell: best } : undefined;
  }
  function tipHTML(h) {
    if (h.gap) return `<b>${h.gap.code} · ${KIND_LABEL[h.gap.kind]}</b><span>${esc(h.gap.label)}</span><span>Score ${h.gap.score.toFixed(2)} · click to open</span>`;
    const c = h.cell;
    if (c.n === 1) return `<b>${esc(c.first.title)}</b><span>${esc(regionName(c.first.fine))}${c.first.year ? ` · ${c.first.year}` : ""}</span>`;
    return `<b>${fmt(c.n)} papers</b><span>Mostly ${esc(regionName(majority(c)))} · click to zoom</span>`;
  }
  function cardHTML() {
    const close = `<button type="button" class="tip-close" aria-label="Close">×</button>`;
    if (pinned.gap) {
      const gp = pinned.gap;
      return `${close}<b class="tip-code">${gp.code} · ${KIND_LABEL[gp.kind]}</b><b>${esc(gp.label)}</b><p>${esc(gp.explanation)}</p>
        <dl><div><dt>Score</dt><dd>${gp.score.toFixed(2)}</dd></div><div><dt>Demand</dt><dd>${fmt(gp.demand)}</dd></div><div><dt>Coverage</dt><dd>${fmt(gp.coverage)}</dd></div></dl>
        <span>A candidate for review in this collection, not a validated discovery.</span>`;
    }
    const p = pinned.point;
    return `${close}<b class="tip-code">${ROLE_LABEL[p.role]}${p.year ? ` · ${p.year}` : ""}</b><b>${esc(p.title)}</b><span>${esc(regionName(p.fine))}</span>`;
  }
  function placeCard() {
    const anchor = pinned.gap ? toScreen(pinned.gap.x, pinned.gap.y) : toScreen(pinned.point.x, pinned.point.y);
    const w = tip.offsetWidth, h = tip.offsetHeight;
    // On narrow screens the card sits at the bottom of the hero, clear of the copy.
    if (W < 760) { tip.style.left = "16px"; tip.style.top = `${Math.max(12, H - h - 72)}px`; return; }
    // A gap's card starts past its code label so the ring stays readable.
    let x = anchor[0] + (pinned.gap ? 56 : 16), y = anchor[1] + 16;
    if (x + w > W - 12) x = anchor[0] - 16 - w;
    if (y + h > H - 12) y = anchor[1] - 16 - h;
    tip.style.left = `${Math.max(12, x)}px`; tip.style.top = `${Math.max(12, y)}px`;
  }
  function pin(next) {
    pinned = next; hover = undefined;
    if (!pinned) { tip.hidden = true; tip.classList.remove("pinned"); syncFlicker(); draw(); return; }
    tip.innerHTML = cardHTML(); tip.classList.add("pinned"); tip.hidden = false;
    tip.querySelector(".tip-close").addEventListener("click", () => pin(undefined));
    placeCard(); syncFlicker(); draw();
  }
  function showHover(h, x, y) {
    hover = h;
    if (pinned) { draw(); return; }
    canvas.style.cursor = drag?.moved ? "grabbing" : h ? "pointer" : inside(x, y) ? "grab" : "";
    if (!h) { tip.hidden = true; draw(); return; }
    tip.innerHTML = tipHTML(h); tip.hidden = false;
    tip.style.left = `${Math.min(x + 14, W - 250)}px`; tip.style.top = `${Math.min(y + 14, H - 80)}px`;
    draw();
  }

  /* Entrance: the squares flicker in as in the app, then the camera picks a random gap on the
     visible part of the map, zooms to it and opens its card. Any interaction cancels the tour. */
  function intro() {
    if (introOver) return;
    const onScreen = (gp) => { const [x, y] = toScreen(gp.x, gp.y); return inside(x, y, R * 0.15) && x > W * 0.45 && x < W - 40 && y > 100 && y < H - 100; };
    const picks = gaps.filter(onScreen).length ? gaps.filter(onScreen) : gaps;
    const gp = picks[Math.floor(Math.random() * picks.length)];
    // On narrow screens the card would cover the copy, so the tour only zooms.
    focusArea(gp.area, () => { if (!introOver) { introOver = true; if (W >= 760) pin({ gap: gp }); } });
  }
  const endIntro = () => { introOver = true; clearTimeout(introTimer); };
  for (const type of ["pointerdown", "wheel", "keydown", "gesturestart"]) canvas.addEventListener(type, endIntro, { capture: true });
  hero.querySelectorAll(".map-controls button").forEach((b) => b.addEventListener("click", endIntro, { capture: true }));

  canvas.addEventListener("pointerdown", (e) => {
    const [x, y] = at(e);
    if (phase !== "done" || !inside(x, y)) return;
    stopZoom();
    // Touch keeps page scrolling; mouse and pen drag to pan, as in the app.
    drag = { x, y, v: view, moved: false, touch: e.pointerType === "touch" };
    if (!drag.touch) canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    const [x, y] = at(e);
    if (drag && !drag.touch) {
      if (Math.abs(x - drag.x) + Math.abs(y - drag.y) > 3) drag.moved = true;
      if (drag.moved) { tip.hidden = !pinned; canvas.style.cursor = "grabbing"; setView(clampPan({ ...drag.v, x: drag.v.x + x - drag.x, y: drag.v.y + y - drag.y })); }
      return;
    }
    const h = find(x, y);
    if (h?.cell === hover?.cell && h?.gap === hover?.gap) { if (h && !pinned) { tip.style.left = `${Math.min(x + 14, W - 250)}px`; tip.style.top = `${Math.min(y + 14, H - 80)}px`; } return; }
    showHover(h, x, y);
  });
  canvas.addEventListener("pointerup", (e) => {
    const d = drag; drag = undefined;
    if (!d) return;
    const [x, y] = at(e);
    if (d.moved || (d.touch && Math.abs(x - d.x) + Math.abs(y - d.y) > 8)) { showHover(find(x, y), x, y); return; }
    const f = find(x, y);
    if (f?.gap) { pin({ gap: f.gap }); focusArea(f.gap.area); }
    else if (f?.cell?.n === 1) pin({ point: f.cell.first });
    else if (f?.cell) { pin(undefined); zoomAt(2.5, f.cell.x, f.cell.y); }
    else pin(undefined);
  });
  canvas.addEventListener("pointercancel", () => { drag = undefined; });
  canvas.addEventListener("pointerleave", () => { if (!drag) showHover(undefined, -1, -1); });

  // Plain scrolling keeps scrolling the page; pinch or ⌘/Ctrl-scroll zooms at the pointer.
  canvas.addEventListener("wheel", (e) => {
    const [x, y] = at(e);
    if (phase !== "done" || !inside(x, y) || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault(); stopZoom();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? H : 1;
    const dy = Math.max(-60, Math.min(60, (e.deltaY || e.deltaX) * unit));
    setView(zoomTo(view, view.s * Math.exp(-dy * ZOOM_PER_DELTA), x, y));
  }, { passive: false });
  canvas.addEventListener("gesturestart", (e) => { e.preventDefault(); stopZoom(); pinch = { s: view.s, v: view }; });
  canvas.addEventListener("gesturechange", (e) => {
    e.preventDefault(); if (!pinch) return;
    const [x, y] = at(e); setView(zoomTo(pinch.v, pinch.s * Math.pow(e.scale, PINCH_DAMPING), x, y));
  });
  canvas.addEventListener("gestureend", (e) => { e.preventDefault(); pinch = undefined; });

  // Controls: zoom in, zoom out, reset (also + − 0 and Escape on the focused map).
  const centre = () => [A.x, A.y];
  hero.querySelector("[data-zoom='in']")?.addEventListener("click", () => zoomAt(1.6, ...centre()));
  hero.querySelector("[data-zoom='out']")?.addEventListener("click", () => zoomAt(1 / 1.6, ...centre()));
  hero.querySelector("[data-zoom='reset']")?.addEventListener("click", () => { pin(undefined); animateTo({ s: START_ZOOM, x: 0, y: 0 }, 450); });
  canvas.addEventListener("keydown", (e) => {
    if (e.key === "+" || e.key === "=") zoomAt(1.6, ...centre());
    else if (e.key === "-") zoomAt(1 / 1.6, ...centre());
    else if (e.key === "0") { pin(undefined); animateTo({ s: START_ZOOM, x: 0, y: 0 }, 450); }
    else if (e.key === "Escape") pin(undefined);
    else return;
    e.preventDefault();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && pinned) pin(undefined); });

  let resizeTimer;
  new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(layout, 80); }).observe(hero);
  document.fonts?.ready.then(draw);
  layout();
  introTimer = setTimeout(intro, reduced ? 300 : DOT_DELAY_MS + DOT_FLICKER_MS + 900);
}

/* ---------- Terminal-style shimmer (src/agents.tsx) ---------- */
function shimmer(el) {
  const text = el.dataset.text, chars = Array.from(text), HEAD = [1, 0.65], BASE = 0.35, PAUSE = 6;
  el.setAttribute("aria-label", text);
  el.innerHTML = chars.map((ch) => `<span class="shimmer-ch" aria-hidden="true">${ch}</span>`).join("");
  if (reduced) return;
  const spans = [...el.children], span = chars.length + 2 * HEAD.length;
  let tick = 0;
  setInterval(() => {
    const head = (tick++ % (span + PAUSE)) - HEAD.length;
    spans.forEach((s, i) => { const d = Math.abs(i - head); s.style.opacity = d < HEAD.length ? HEAD[d] : BASE; });
  }, 120);
}

/* ---------- Model picker (src/AgentAttribution.tsx + src/ModelSelector.tsx) ----------
   The suggestion's author stays fixed; choosing a model sets the preference for future work
   ("Next: …"); the switch goes back to following the agent's current model. */
function modelPicker() {
  const root = document.querySelector(".app-window");
  if (!root) return;
  const trigger = root.querySelector(".agent-attribution"), pop = root.querySelector(".model-popover");
  const selector = pop.querySelector(".model-selector"), sw = pop.querySelector(".model-current-switch");
  const next = root.querySelector(".next-model"), options = [...pop.querySelectorAll(".model-option")];
  let last = "Claude Opus 5.5 Medium", preferred = null;
  const check = '<svg width="14" height="14" aria-hidden="true"><use href="#i-check"/></svg>';
  function render() {
    const value = preferred ?? last;
    for (const o of options) {
      const on = o.textContent.trim() === value;
      o.setAttribute("aria-pressed", String(on));
      o.querySelector("svg")?.remove();
      if (on) o.insertAdjacentHTML("beforeend", check);
    }
    selector.dataset.followCurrent = String(!preferred);
    sw.setAttribute("aria-checked", String(!preferred));
    next.hidden = !preferred; next.textContent = preferred ? `Next: ${preferred}` : "";
  }
  options.forEach((o) => o.addEventListener("click", () => { preferred = last = o.textContent.trim(); render(); }));
  sw.addEventListener("click", () => { preferred = preferred ? null : last; render(); });
  pop.querySelectorAll(".model-provider-heading").forEach((h) => h.addEventListener("click", () => {
    const open = h.getAttribute("aria-expanded") !== "true";
    h.setAttribute("aria-expanded", String(open)); h.nextElementSibling.hidden = !open;
  }));
  const setOpen = (open) => { pop.hidden = !open; trigger.setAttribute("aria-expanded", String(open)); };
  trigger.addEventListener("click", () => setOpen(pop.hidden));
  document.addEventListener("pointerdown", (e) => { if (!pop.hidden && !pop.contains(e.target) && !trigger.contains(e.target)) setOpen(false); });
  pop.addEventListener("keydown", (e) => { if (e.key === "Escape") { setOpen(false); trigger.focus(); } });
  render();
}

/* ---------- Download button: name the visitor's platform ---------- */
function downloadButton() {
  const label = document.querySelector("#download .download-label");
  if (!label) return;
  const p = (navigator.userAgentData?.platform || navigator.platform || navigator.userAgent).toLowerCase();
  const name = /mac|iphone|ipad/.test(p) ? "macOS" : /win/.test(p) ? "Windows" : /linux|x11|cros/.test(p) ? "Linux" : null;
  if (name) label.textContent = `Download for ${name}`;
}

/* ---------- inVectus search example: real precomputed checks, nearest papers on the map ---------- */
function searchDemo() {
  const D = window.INVECTUS_MAP, X = window.INVECTUS_SEARCH;
  const root = document.querySelector(".search-demo");
  if (!D || !X || !root) return;
  const textEl = root.querySelector(".search-text"), chips = root.querySelector(".search-chips");
  const verdictEl = root.querySelector(".verdict"), summaryEl = root.querySelector(".search-summary");
  const hitsEl = root.querySelector(".hits"), metaEl = root.querySelector(".search-meta");
  const canvas = root.querySelector(".search-map"), g = canvas.getContext("2d");
  const ink = "#d1cbc2", accent = "#6edcaa", bg = "#141414", inkA = (a) => `rgba(209, 203, 194, ${a})`;
  const VERDICT = { exists: "Exists · something very close is already here", near: "Near · related work, not the same thing", open: "Open · not found in this collection" };
  const here = (t) => t.replace(/\bin papers\b/g, "in this collection");
  const points = D.points;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const fit = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, extent: Math.max(x1 - x0, y1 - y0) };
  const flicker = new DotFlicker();
  let size = 0, view = { s: 1, x: 0, y: 0 }, cells = [], current, hot = -1, frame, cam, typing;

  const k = () => (size * 0.94) / fit.extent;
  const toScreen = (x, y) => [size / 2 + (x - fit.cx) * k() * view.s + view.x, size / 2 + (y - fit.cy) * k() * view.s + view.y];
  const inside = (x, y, pad = 0) => (x - size / 2) ** 2 + (y - size / 2) ** 2 <= (size / 2 - pad) ** 2;

  function rebuild() {
    const CELL = HERO_CELL, cols = Math.ceil(size / CELL) + 2, grid = new Map();
    points.forEach(([px, py], i) => {
      const [x, y] = toScreen(px, py);
      if (!inside(x, y, -6)) return;
      const key = Math.floor(y / CELL) * cols + Math.floor(x / CELL), c = grid.get(key);
      if (c) { c.x += x; c.y += y; c.n++; } else grid.set(key, { x, y, n: 1, i });
    });
    cells = [...grid.values()].map((c) => ({ x: c.x / c.n, y: c.y / c.n, n: c.n, key: `p:${c.i}` }));
    const keys = cells.map((c) => c.key);
    if (current) current.hits.forEach((h) => keys.push(`hit:${current.query}:${h.point}`)), keys.push(`q:${current.query}`);
    flicker.sync(keys, performance.now());
    draw();
  }
  const queryPos = (ex) => { // similarity-weighted centre of the nearest papers: approximate, display only
    let sx = 0, sy = 0, sw = 0;
    for (const h of ex.hits) { const w = h.similarity ** 8; sx += points[h.point][0] * w; sy += points[h.point][1] * w; sw += w; }
    return [sx / sw, sy / sw];
  };

  function draw() {
    cancelAnimationFrame(frame);
    const now = performance.now(), R = size / 2, op = (key) => flicker.opacity(key, now);
    g.clearRect(0, 0, size, size);
    g.save(); g.beginPath(); g.arc(R, R, R - 1, 0, Math.PI * 2); g.clip();
    g.fillStyle = ink;
    for (const c of cells) {
      const s = heroSide(c.n);
      g.globalAlpha = (current ? 0.32 : 0.62) * op(c.key);
      g.fillRect(c.x - s / 2, c.y - s / 2, s, s);
    }
    if (current) {
      g.font = LABEL_FONT; g.textBaseline = "middle";
      const placed = []; // label boxes, so close papers don't print over each other
      const order = current.hits.map((h, i) => i).sort((a, b) => (b === hot) - (a === hot));
      order.forEach((i) => { const h = current.hits[i];
        const [x, y] = toScreen(points[h.point][0], points[h.point][1]);
        const on = i === hot;
        g.globalAlpha = op(`hit:${current.query}:${h.point}`);
        g.strokeStyle = accent; g.fillStyle = accent; g.lineWidth = on ? 2 : 1.25;
        const r = on ? 7 : 5;
        g.beginPath(); g.moveTo(x - r, y - r); g.lineTo(x + r, y + r); g.moveTo(x + r, y - r); g.lineTo(x - r, y + r); g.stroke();
        const box = { x: x + 7, y: y - 14, w: 30, h: 14 };
        if (placed.some((b) => box.x < b.x + b.w && b.x < box.x + box.w && box.y < b.y + b.h && b.y < box.y + box.h)) return;
        placed.push(box);
        g.lineWidth = 3; g.strokeStyle = bg; g.strokeText(h.similarity.toFixed(2), x + 9, y - 7);
        g.fillText(h.similarity.toFixed(2), x + 9, y - 7);
      });
      const [qx0, qy0] = queryPos(current), [qx, qy] = toScreen(qx0, qy0);
      g.globalAlpha = op(`q:${current.query}`);
      g.shadowColor = accent; g.shadowBlur = 16; g.strokeStyle = accent; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(qx - 8, qy); g.lineTo(qx + 8, qy); g.moveTo(qx, qy - 8); g.lineTo(qx, qy + 8); g.stroke();
      g.shadowBlur = 0; g.fillStyle = accent; g.fillText("QUERY", qx + 11, qy + 11);
    }
    g.globalAlpha = 1; g.restore();
    g.strokeStyle = ink; g.lineWidth = 1; g.beginPath(); g.arc(R, R, R - 1, 0, Math.PI * 2); g.stroke();
    if (flicker.pending(now)) frame = requestAnimationFrame(draw);
  }

  // Camera: centre the nearest papers and fit them, as the app focuses a region.
  function focus(ex) {
    const [cx, cy] = queryPos(ex);
    let r = 0; for (const h of ex.hits) r = Math.max(r, Math.hypot(points[h.point][0] - cx, points[h.point][1] - cy));
    const s = Math.min(14, Math.max(1, (size * 0.3) / Math.max(1e-6, r * k())));
    const target = { s, x: -(cx - fit.cx) * k() * s, y: -(cy - fit.cy) * k() * s };
    cancelAnimationFrame(cam);
    if (reduced) { view = target; rebuild(); return; }
    const start = view, t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / 700), e = p * p * (3 - 2 * p), sc = start.s * Math.pow(target.s / start.s, e);
      view = { s: sc, x: (start.x / start.s + (target.x / target.s - start.x / start.s) * e) * sc, y: (start.y / start.s + (target.y / target.s - start.y / start.s) * e) * sc };
      rebuild();
      if (p < 1) cam = requestAnimationFrame(step);
    };
    cam = requestAnimationFrame(step);
  }

  function show(ex, chip) {
    chips.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
    clearInterval(typing);
    // Fade the old verdict, summary and results out while the new idea types in; clear them
    // only once they are invisible, so the verdict dot leaves with the text.
    const result = root.querySelector(".search-result");
    result.classList.add("fading");
    current = undefined; hot = -1; draw();
    const clear = setTimeout(() => { hitsEl.innerHTML = ""; verdictEl.className = "verdict"; verdictEl.textContent = ""; summaryEl.textContent = ""; metaEl.textContent = ""; }, reduced ? 0 : 200);
    const reveal = () => {
      clearTimeout(clear);
      current = ex;
      verdictEl.className = `verdict ${ex.verdict}`;
      verdictEl.textContent = VERDICT[ex.verdict];
      summaryEl.textContent = `${here(ex.summary)} ${ex.next_step}`;
      hitsEl.innerHTML = ex.hits.map((h, i) => `<li style="--i:${i}" data-i="${i}"><span class="score${i === 0 ? " top" : ""}">${h.similarity.toFixed(2)}</span><span>${esc(h.title)}<em>${h.year} · ${h.role}</em><span class="meter"><span style="--w:${Math.max(0.05, (h.similarity - 0.5) / 0.5).toFixed(3)}"></span></span></span></li>`).join("");
      metaEl.textContent = `Compared with all ${fmt(ex.compared)} stored vectors, exactly. Probability it exists: ${ex.p_exists.toFixed(2)}. ${ex.position} Calibration: ${ex.calibration}`;
      focus(ex);
      requestAnimationFrame(() => result.classList.remove("fading"));
    };
    if (reduced) { textEl.textContent = ex.query; reveal(); return; }
    let n = 0; textEl.textContent = "";
    typing = setInterval(() => { textEl.textContent = ex.query.slice(0, ++n); if (n >= ex.query.length) { clearInterval(typing); setTimeout(reveal, 180); } }, 22);
  }

  chips.innerHTML = X.map((ex, i) => `<button type="button" class="chip" aria-pressed="false" data-i="${i}">${esc(ex.query)}</button>`).join("");
  chips.addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (b) show(X[+b.dataset.i], b); });
  const setHot = (i) => { hot = i; hitsEl.querySelectorAll("li").forEach((li) => li.classList.toggle("on", +li.dataset.i === i)); draw(); };
  hitsEl.addEventListener("pointerover", (e) => { const li = e.target.closest("li"); if (li) setHot(+li.dataset.i); });
  hitsEl.addEventListener("pointerleave", () => setHot(-1));
  canvas.addEventListener("pointermove", (e) => {
    if (!current) return;
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = -1, bd = 144;
    current.hits.forEach((h, i) => { const [hx, hy] = toScreen(points[h.point][0], points[h.point][1]); const d = (hx - x) ** 2 + (hy - y) ** 2; if (d < bd) { bd = d; best = i; } });
    if (best !== hot) setHot(best);
  });
  canvas.addEventListener("pointerleave", () => setHot(-1));

  function resize() {
    const w = canvas.getBoundingClientRect().width, dpr = window.devicePixelRatio || 1;
    if (!w || w === size) return;
    size = w; canvas.width = Math.round(w * dpr); canvas.height = Math.round(w * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (current) focus(current); else rebuild();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();
  // Start the first example when the section comes into view.
  const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { io.disconnect(); show(X[0], chips.querySelector(".chip")); } }, { threshold: 0.3 });
  io.observe(root);
}

/* ---------- Copy the install command ---------- */
function copyButtons() {
  document.querySelectorAll(".copy[data-copy]").forEach((b) => b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); } catch { return; }
    b.classList.add("done"); b.setAttribute("aria-label", "Copied");
    setTimeout(() => { b.classList.remove("done"); b.setAttribute("aria-label", "Copy command"); }, 1600);
  }));
}

/* ---------- Footer wordmark: "inVectus" drawn in the map's squares ----------
   Squares flicker in when the footer appears; near the cursor they light up in the accent.
   The bottom of the letters runs off the page, like the hero circle. */
function footerMark() {
  const canvas = document.querySelector(".foot-mark");
  if (!canvas) return;
  const g = canvas.getContext("2d"), flicker = new DotFlicker();
  const ink = "#d1cbc2", accent = "#6edcaa", STEP = 7, SQ = 4;
  let dots = [], W = 0, H = 0, mouse = null, frame, shown = false;
  function layout() {
    W = canvas.getBoundingClientRect().width;
    if (!W) return;
    // Size the word to the width, then keep only the top ~78% so it runs off the bottom.
    const probe = document.createElement("canvas").getContext("2d");
    const font = (px) => `300 ${px}px "Inter Variable", Inter, sans-serif`;
    probe.font = font(100);
    const m = probe.measureText("inVectus"), px = (100 * W * 0.98) / m.width;
    const ascent = (m.actualBoundingBoxAscent / 100) * px;
    H = Math.round(ascent * 0.8);
    const off = document.createElement("canvas"); off.width = Math.ceil(W); off.height = H;
    const o = off.getContext("2d");
    o.font = font(px); o.textBaseline = "alphabetic"; o.fillStyle = "#000";
    o.fillText("inVectus", (W - (m.width / 100) * px) / 2, ascent * 1.02);
    const data = o.getImageData(0, 0, off.width, H).data;
    dots = [];
    for (let y = STEP / 2; y < H; y += STEP) for (let x = STEP / 2; x < W; x += STEP) {
      if (data[(Math.floor(y) * off.width + Math.floor(x)) * 4 + 3] > 128) dots.push({ x, y, key: `${x},${y}`, glow: 0 });
    }
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); canvas.style.height = `${H}px`;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (shown) flicker.sync(dots.map((d) => d.key), performance.now());
    draw();
  }
  function draw() {
    cancelAnimationFrame(frame);
    const now = performance.now();
    g.clearRect(0, 0, W, H);
    let busy = flicker.pending(now);
    for (const d of dots) {
      const near = mouse ? Math.max(0, 1 - Math.hypot(d.x - mouse.x, d.y - mouse.y) / 90) : 0;
      d.glow += (near - d.glow) * (reduced ? 1 : 0.18);
      if (Math.abs(near - d.glow) > 0.01) busy = true;
      const o = shown ? flicker.opacity(d.key, now) : 0;
      g.globalAlpha = (0.16 + 0.6 * d.glow) * o;
      g.fillStyle = d.glow > 0.05 ? accent : ink;
      const s = SQ + d.glow * 2;
      g.fillRect(d.x - s / 2, d.y - s / 2, s, s);
    }
    g.globalAlpha = 1;
    if (busy) frame = requestAnimationFrame(draw);
  }
  canvas.addEventListener("pointermove", (e) => { const r = canvas.getBoundingClientRect(); mouse = { x: e.clientX - r.left, y: e.clientY - r.top }; draw(); });
  canvas.addEventListener("pointerleave", () => { mouse = null; draw(); });
  new IntersectionObserver((entries, io) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    io.disconnect(); shown = true; flicker.sync(dots.map((d) => d.key), performance.now()); draw();
  }, { threshold: 0.2 }).observe(canvas);
  let t;
  new ResizeObserver(() => { clearTimeout(t); t = setTimeout(layout, 100); }).observe(canvas);
  (document.fonts?.ready ?? Promise.resolve()).then(layout);
}

/* ---------- Reveal on scroll ---------- */
function reveals() {
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }), { threshold: 0.15 });
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
}

heroMap();
document.querySelectorAll(".shimmer").forEach(shimmer);
modelPicker();
searchDemo();
copyButtons();
footerMark();
downloadButton();
reveals();
