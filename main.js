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
  let W = 0, H = 0, R = 0, C = { x: 0, y: 0 }, A = { x: 0, y: 0 }, cells = [], frame = 0, zoomFrame;
  let view = { s: START_ZOOM, x: 0, y: 0 }, hover, pinned, drag, pinch;
  const t0 = performance.now();
  let phase = "done", laidOut = false, introTimer, introOver = false;

  const toScreen = (x, y) => [A.x + (x - fit.cx) * fit.k * view.s + view.x, A.y + (y - fit.cy) * fit.k * view.s + view.y];
  const inside = (x, y, pad = 0) => (x - C.x) ** 2 + (y - C.y) ** 2 <= (R - pad) ** 2;
  const regionName = (id) => regions.get(id)?.label ?? "";

  function layout() {
    const rect = hero.getBoundingClientRect();
    W = rect.width; H = rect.height;
    if (W <= 1024) {
      // A 120vw circle bleeds 10vw off each side; crop its bottom 30%.
      // CSS reserves 84vw (70% of the diameter) below the real-data note.
      R = W * 0.6;
      C = { x: W / 2, y: H - R + R * 2 * 0.3 };
      A = { ...C };
      fit.k = (R * 1.72) / fit.extent;
    } else {
      // Keep the desktop copy clear of the bottom-right circle.
      const box = [...hero.querySelectorAll(".hero-copy > *:not(.hero-gaps)")].map((el) => el.getBoundingClientRect())
        .reduce((a, b) => ({ right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) }), { right: 0, bottom: 0 });
      const clear = Math.hypot(Math.max(0, W - (box.right - rect.left)), Math.max(0, H - (box.bottom - rect.top))) - 28;
      R = Math.max(Math.hypot(W, H) * 0.3, Math.min(Math.hypot(W, H) * 0.56, clear));
      C = { x: W, y: H };
      A = { x: W - R * 0.5, y: H - R * 0.5 };
      fit.k = (R * 0.86) / fit.extent;
    }
    if (!laidOut) { view = { s: START_ZOOM, x: 0, y: 0 }; laidOut = true; }
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    // Clip the hit area as well as the drawing: only circle-origin gestures belong to the map.
    canvas.style.clipPath = `circle(${R}px at ${C.x}px ${C.y}px)`;
    // Share the circle with the starfield and the rim trail below the hero.
    dispatchEvent(new CustomEvent("herocircle", { detail: { C: { ...C }, R, W, H } }));
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
    g.beginPath(); g.arc(C.x, C.y, R - 1, 0, Math.PI * 2); g.clip();

    if (phase !== "done") {
      const ease = glide * glide * (3 - 2 * glide);
      g.fillStyle = INK;
      for (let i = 0; i < PLACEHOLDERS; i++) {
        const [ux, uy] = disc(i);
        let x = C.x + ux * R, y = C.y + uy * R;
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
    g.beginPath(); g.arc(C.x, C.y, R - 1, 0, Math.PI * 2); g.stroke();
    if (phase === "index") {
      g.lineWidth = 3;
      g.beginPath(); g.arc(C.x, C.y, R - 2, -Math.PI / 2, -Math.PI / 2 - frac * Math.PI / 2, true); g.stroke();
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
    hero.querySelectorAll(".hero-gaps li").forEach((li) => li.classList.toggle("on", !!next?.gap && gaps[+li.dataset.i] === next.gap));
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

  // The app's ranked gap list beside the map: hover a row to light its ring, click to open it.
  const list = hero.querySelector(".hero-gaps");
  if (list) {
    list.innerHTML = gaps.slice(0, 5).map((gp, i) => `<li tabindex="0" style="--i:${i}" data-i="${i}"><span class="code">${gp.code}</span><span class="label">${esc(gp.label)}</span><span class="score">${gp.score.toFixed(2)}</span></li>`).join("");
    const row = (e) => e.target.closest("li");
    list.addEventListener("pointerover", (e) => { const li = row(e); if (!li || pinned) return; hover = { gap: gaps[+li.dataset.i] }; draw(); });
    list.addEventListener("pointerleave", () => { if (!pinned) { hover = undefined; draw(); } });
    const open = (li) => { endIntro(); const gp = gaps[+li.dataset.i]; pin({ gap: gp }); focusArea(gp.area); list.querySelectorAll("li").forEach((x) => x.classList.toggle("on", x === li)); };
    list.addEventListener("click", (e) => { const li = row(e); if (li) open(li); });
    list.addEventListener("keydown", (e) => { const li = row(e); if (li && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(li); } });
  }
  for (const type of ["pointerdown", "wheel", "keydown", "gesturestart"]) canvas.addEventListener(type, endIntro, { capture: true });
  hero.querySelectorAll(".map-controls button").forEach((b) => b.addEventListener("click", endIntro, { capture: true }));

  const touches = new Map();
  let touchPinch;
  const touchPair = () => {
    const [a, b] = [...touches.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)) };
  };
  canvas.addEventListener("pointerdown", (e) => {
    const [x, y] = at(e);
    if (phase !== "done" || !inside(x, y)) return;
    stopZoom();
    const touch = e.pointerType === "touch";
    canvas.setPointerCapture(e.pointerId);
    if (touch) {
      touches.set(e.pointerId, { x, y });
      if (touches.size >= 2) {
        touchPinch = { ...touchPair(), v: view };
        drag = undefined;
        return;
      }
    }
    drag = { x, y, v: view, moved: false, touch, id: e.pointerId };
  });
  canvas.addEventListener("pointermove", (e) => {
    const [x, y] = at(e);
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x, y });
    if (touchPinch) {
      const pair = touchPair(), start = touchPinch;
      const next = zoomTo(start.v, start.v.s * Math.pow(pair.distance / start.distance, PINCH_DAMPING), start.x, start.y);
      setView(clampPan({ ...next, x: next.x + pair.x - start.x, y: next.y + pair.y - start.y }));
      return;
    }
    if (drag && drag.id === e.pointerId) {
      if (Math.abs(x - drag.x) + Math.abs(y - drag.y) > (drag.touch ? 8 : 3)) drag.moved = true;
      if (drag.moved) { tip.hidden = !pinned; canvas.style.cursor = "grabbing"; setView(clampPan({ ...drag.v, x: drag.v.x + x - drag.x, y: drag.v.y + y - drag.y })); }
      return;
    }
    if (e.pointerType === "touch") return;
    const h = find(x, y);
    if (h?.cell === hover?.cell && h?.gap === hover?.gap) { if (h && !pinned) { tip.style.left = `${Math.min(x + 14, W - 250)}px`; tip.style.top = `${Math.min(y + 14, H - 80)}px`; } return; }
    showHover(h, x, y);
  });
  function releasePointer(e, cancelled = false) {
    touches.delete(e.pointerId);
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (touchPinch) {
      touchPinch = touches.size >= 2 ? { ...touchPair(), v: view } : undefined;
      const remaining = touches.entries().next().value;
      // After a pinch, one finger can keep panning; lifting it must never count as a tap.
      drag = !touchPinch && remaining ? { ...remaining[1], id: remaining[0], v: view, moved: true, touch: true } : undefined;
      return;
    }
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag; drag = undefined;
    canvas.style.cursor = "";
    if (cancelled) return;
    const [x, y] = at(e);
    if (d.moved || (d.touch && Math.abs(x - d.x) + Math.abs(y - d.y) > 8)) {
      if (!d.touch) showHover(find(x, y), x, y);
      return;
    }
    const f = find(x, y);
    if (f?.gap) { pin({ gap: f.gap }); focusArea(f.gap.area); }
    else if (f?.cell?.n === 1) pin({ point: f.cell.first });
    else if (f?.cell) { pin(undefined); zoomAt(2.5, f.cell.x, f.cell.y); }
    else pin(undefined);
  }
  canvas.addEventListener("pointerup", (e) => releasePointer(e));
  canvas.addEventListener("pointercancel", (e) => releasePointer(e, true));
  canvas.addEventListener("pointerleave", () => { if (!drag && !touchPinch) showHover(undefined, -1, -1); });

  // Plain scrolling keeps scrolling the page; pinch or ⌘/Ctrl-scroll zooms at the pointer.
  canvas.addEventListener("wheel", (e) => {
    const [x, y] = at(e);
    if (phase !== "done" || !inside(x, y) || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault(); stopZoom();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? H : 1;
    const dy = Math.max(-60, Math.min(60, (e.deltaY || e.deltaX) * unit));
    setView(zoomTo(view, view.s * Math.exp(-dy * ZOOM_PER_DELTA), x, y));
  }, { passive: false });
  canvas.addEventListener("gesturestart", (e) => {
    const [x, y] = at(e);
    if (!inside(x, y)) return;
    e.preventDefault();
    if (touches.size) return;
    stopZoom(); pinch = { s: view.s, v: view };
  });
  canvas.addEventListener("gesturechange", (e) => {
    if (touches.size) { e.preventDefault(); return; }
    if (!pinch) return;
    e.preventDefault();
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

/* ---------- Agent chat: abstract bubbles, real inVectus results, illustrative wording ----------
   Three exchanges: ChatGPT answers a gap question (list_gaps); Claude (near) and Grok (open)
   answer "is this new?" questions (check_idea). The numbers, verdict and papers are real results from the Ophthalmology
   Research collection; the sentences around them are written for the demo. */
function agentChat() {
  const root = document.querySelector(".chat");
  if (!root) return;
  const log = root.querySelector(".chat-log"), wire = document.querySelector(".wire");
  const STEPS = [
    { user: "Which topics have plenty of studies but no reviews yet?" },
    { bot: "chatgpt", name: "ChatGPT", mark: "#mark-openai", tool: "list_gaps",
      think: ["Looking for topics with studies but no reviews", "Calling inVectus · list_gaps (coverage)", "Comparing the top 3 gaps"],
      text: "The strongest one is <b>neurons · cortex · colliculus</b>: 105 studies and no review reaching that region, with activity up 32% a year. Next are retinal gene and cell work (108 studies) and luminance and colour vision (82).",
      cite: "In your collection only · <b>G-01</b>, G-02, G-03" },
    { user: "Has anyone looked at the gut microbiome and uveitis flares?" },
    { bot: "claude", name: "Claude", mark: "#mark-claude", tool: "check_idea",
      think: ["Checking whether this idea is already in the collection", "Calling inVectus · check_idea", "Reading the nearest papers"],
      text: "<b>Near, not the same.</b> Related work is here, but nothing on that exact question. It sits between the HLA-B27 uveitis papers and the experimental autoimmune uveitis work.",
      cite: "Nearest: <b>Immunosuppression in the Management of Presumed Non-infective Uveitis</b> (2020, 0.83) · <b>HLA-B27 positive idiopathic acute anterior uveitis: a unique manifestation of subclinical gut inflammation</b> (1990, 0.78)" },
    { user: "Is VR training for strabismus surgery residents already covered?" },
    { bot: "grok", name: "Grok", mark: "#mark-grok", tool: "check_idea",
      think: ["Checking the idea against your collection", "Calling inVectus · check_idea", "Reading the closest matches"],
      text: "<b>Open in this collection.</b> Nothing here looks like the same thing. The closest work tests ocular misalignment in VR and trains surgeons in virtual laparoscopy, not strabismus surgery itself. Check outside sources before relying on it.",
      cite: "Nearest: <b>Stepping into the virtual unknown: feasibility study of a virtual reality-based test of ocular misalignment</b> (2017, 0.80) · <b>Eye trackers in a virtual laparoscopic training environment</b> (2003, 0.79)" },
  ];
  // One exchange at a time: question, typing, answer; hold; both fade out; the next exchange.
  const EXCHANGES = [[STEPS[0], STEPS[1]], [STEPS[2], STEPS[3]], [STEPS[4], STEPS[5]]];
  let timers = [], index = 0, visible = false, running = false;
  const later = (ms, fn) => timers.push(setTimeout(fn, ms));
  const add = (cls, html) => { const li = document.createElement("li"); li.className = cls; li.innerHTML = html; log.appendChild(li); return li; };
  const pulse = (dir) => { if (!wire || reduced) return; wire.classList.remove("out", "back"); void wire.offsetWidth; wire.classList.add(dir); };
  // Wrap every word in a span so the answer fades in word by word (tags like <b> are kept).
  function wordify(el) {
    let i = 0;
    const walk = (node) => {
      for (const child of [...node.childNodes]) {
        if (child.nodeType === 3) {
          const frag = document.createDocumentFragment();
          for (const part of child.textContent.split(/(\s+)/)) {
            if (!part) continue;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); continue; }
            const w = document.createElement("span"); w.className = "w"; w.style.setProperty("--i", i++); w.textContent = part; frag.appendChild(w);
          }
          child.replaceWith(frag);
        } else walk(child);
      }
    };
    walk(el);
  }
  const answer = (step) => {
    const li = add("c-bot", `<span class="c-avatar"><svg width="16" height="16" aria-hidden="true"><use href="${step.mark}"/></svg></span><div class="c-reply"><span class="c-name">${step.name}</span><p>${step.text}</p><span class="c-cite">${step.cite}</span></div>`);
    if (!reduced) wordify(li.querySelector(".c-reply"));
    const words = li.querySelectorAll(".w").length;
    li.insertAdjacentHTML("afterend", `<li class="c-chip" style="animation-delay:${words * 28 + 200}ms">via inVectus · <b>${step.tool}</b></li>`);
  };
  function exchange() {
    const [q, a] = EXCHANGES[index];
    log.classList.remove("leaving"); log.innerHTML = "";
    if (reduced) { add("c-user", esc(q.user)); answer(a); return; }
    add("c-user", esc(q.user));
    // What the agent shows while it works: short status lines with the terminal shimmer.
    let think, ticker;
    const say = (text) => {
      const line = think.querySelector(".c-think-text");
      // Letters sit inside per-word spans so long lines wrap between words on small screens.
      line.innerHTML = text.split(" ").map((word) => `<span class="tw">${Array.from(word).map((ch) => `<span class="shimmer-ch">${esc(ch)}</span>`).join("")}</span>`).join(" ");
      line.setAttribute("aria-label", text);
      const chars = [...line.querySelectorAll(".shimmer-ch")], span = chars.length + 4;
      let tick = 0;
      clearInterval(ticker);
      ticker = setInterval(() => {
        const head = (tick++ % (span + 6)) - 2;
        chars.forEach((c, i) => { const d = Math.abs(i - head); c.style.opacity = d === 0 ? 1 : d === 1 ? 0.65 : 0.35; });
      }, 120);
    };
    later(700, () => {
      think = add("c-think", `<span class="c-avatar"><svg width="16" height="16" aria-hidden="true"><use href="${a.mark}"/></svg></span><span class="c-think-text"></span>`);
      say(a.think[0]);
    });
    later(1500, () => { say(a.think[1]); pulse("out"); });
    later(2400, () => { say(a.think[2]); pulse("back"); });
    later(3300, () => { clearInterval(ticker); think?.remove(); answer(a); });
    later(9300, () => log.classList.add("leaving"));
    later(9800, () => {
      index = (index + 1) % EXCHANGES.length;
      if (visible) exchange(); else running = false;
    });
  }
  function start() { if (running) return; running = true; timers.forEach(clearTimeout); timers = []; exchange(); }
  new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    if (visible) start();
  }, { threshold: 0.3 }).observe(root);
}

/* ---------- Hero starfield: faint light squares outside the circle ----------
   Three depths (size, opacity, scroll drift) like the stars at the bottom of the page; they
   flicker in with the map and stay out of the circle, the copy and the gap list. */
function heroStars() {
  const hero = document.querySelector(".hero"), canvas = hero?.querySelector(".hero-stars");
  if (!canvas) return;
  const g = canvas.getContext("2d"), ink = getComputedStyle(hero).getPropertyValue("--ink-rgb").trim() || "27, 26, 24";
  const DEPTHS = [{ size: 3, alpha: 0.32, drift: 0.05 }, { size: 2, alpha: 0.2, drift: 0.12 }, { size: 2, alpha: 0.11, drift: 0.2 }];
  const parallax = !reduced && matchMedia("(pointer: fine) and (min-width: 1025px)").matches;
  const flicker = {
    starts: new Map(), until: 0,
    sync(keys, now) { this.starts = new Map(); this.until = 0; for (const k of keys) { const t = now + 300 + Math.random() * 1400; this.starts.set(k, t); this.until = Math.max(this.until, t + 600); } },
    opacity(k, now) { const t = this.starts.get(k); if (reduced || t === undefined || now >= t + 600) return 1; if (now < t) return 0; return [1, 0.2, 0.85, 0.35, 0.7, 0.5][Math.floor((now - t) / 600 * 6)]; },
    pending(now) { return now < this.until; },
  };
  let stars = [], W = 0, H = 0, circle = null, frame, shift = 0, started = false;
  function layout() {
    if (!circle) return;
    const r = hero.getBoundingClientRect(); W = r.width; H = r.height;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const avoid = [".hero-copy > *", ".hero-note", ".nav", ".map-controls"].flatMap((sel) => [...document.querySelectorAll(sel)])
      .map((el) => el.getBoundingClientRect()).filter((b) => b.width).map((b) => ({ l: b.left - r.left - 28, t: b.top - r.top - 16, rt: b.right - r.left + 28, b: b.bottom - r.top + 16 }));
    let seed = 7321;
    const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const count = Math.round((W * H) / 5200), MIN = 14;
    stars = [];
    for (let i = 0; i < count * 4 && stars.length < count; i++) {
      const x = rand() * W, y = rand() * H;
      if (Math.hypot(x - circle.C.x, y - circle.C.y) < circle.R + 18) continue;
      if (avoid.some((b) => x > b.l && x < b.rt && y > b.t && y < b.b)) continue;
      if (stars.some((o) => (o.x - x) ** 2 + (o.y - y) ** 2 < MIN * MIN)) continue;
      const v = rand();
      stars.push({ x, y, d: DEPTHS[v < 0.2 ? 0 : v < 0.55 ? 1 : 2], key: `h:${i}` });
    }
    if (!started) { started = true; flicker.sync(stars.map((s) => s.key), performance.now()); }
    draw();
  }
  function draw() {
    cancelAnimationFrame(frame);
    const now = performance.now();
    g.clearRect(0, 0, W, H);
    for (const s of stars) {
      g.globalAlpha = s.d.alpha * flicker.opacity(s.key, now);
      g.fillStyle = `rgb(${ink})`;
      const y = s.y + shift * s.d.drift;
      g.fillRect(Math.round(s.x - s.d.size / 2), Math.round(y - s.d.size / 2), s.d.size, s.d.size);
    }
    g.globalAlpha = 1;
    if (flicker.pending(now)) frame = requestAnimationFrame(draw);
  }
  addEventListener("herocircle", (e) => { circle = e.detail; layout(); });
  if (parallax) {
    let ticking = false;
    addEventListener("scroll", () => {
      if (ticking || scrollY > innerHeight * 1.2) return;
      ticking = true; requestAnimationFrame(() => { ticking = false; shift = scrollY; draw(); });
    }, { passive: true });
  }
}

/* ---------- Rim trail: the hero circle's edge continues faintly into the dark section ---------- */
function rimTrail() {
  const hero = document.querySelector(".hero"), section = document.querySelector("#features"), canvas = section?.querySelector(".rim-trail");
  if (!hero || !canvas) return;
  const g = canvas.getContext("2d");
  let circle = null;
  function draw() {
    if (!circle) return;
    const hr = hero.getBoundingClientRect(), sr = section.getBoundingClientRect();
    const W = sr.width, Hc = canvas.getBoundingClientRect().height, dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(Hc * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // The circle's centre in this section's coordinates (the hero sits directly above it).
    const cx = hr.left - sr.left + circle.C.x, cy = hr.top - sr.top + circle.C.y;
    const fade = g.createLinearGradient(0, 0, 0, Hc);
    fade.addColorStop(0, "rgba(209, 203, 194, 0.3)");
    fade.addColorStop(0.5, "rgba(209, 203, 194, 0.1)");
    fade.addColorStop(1, "rgba(209, 203, 194, 0)");
    g.clearRect(0, 0, W, Hc);
    g.strokeStyle = fade; g.lineWidth = 1;
    g.beginPath(); g.arc(cx, cy, circle.R - 1, 0, Math.PI * 2); g.stroke();
  }
  addEventListener("herocircle", (e) => { circle = e.detail; requestAnimationFrame(draw); });
  new ResizeObserver(() => requestAnimationFrame(draw)).observe(section);
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
  const ex = X.find((example) => example.query === "Gut microbiome and uveitis flares");
  if (!ex) return;
  const textEl = root.querySelector(".search-text");
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

  function show() {
    const result = root.querySelector(".search-result"), note = root.parentElement.querySelector(".figure-note");
    const reveal = () => {
      current = ex;
      verdictEl.className = `verdict ${ex.verdict}`;
      verdictEl.textContent = VERDICT[ex.verdict];
      summaryEl.textContent = `${here(ex.summary)} ${ex.next_step}`;
      hitsEl.innerHTML = ex.hits.map((h, i) => `<li style="--i:${i}" data-i="${i}"><span class="score${i === 0 ? " top" : ""}">${h.similarity.toFixed(2)}</span><span>${esc(h.title)}<em>${h.year} · ${h.role}</em><span class="meter"><span style="--w:${Math.max(0.05, (h.similarity - 0.5) / 0.5).toFixed(3)}"></span></span></span></li>`).join("");
      metaEl.textContent = `Compared with all ${fmt(ex.compared)} stored vectors, exactly. Probability it exists: ${ex.p_exists.toFixed(2)}. ${ex.position} Calibration: ${ex.calibration}`;
      focus(ex);
      requestAnimationFrame(() => {
        result.classList.remove("fading"); note?.classList.remove("fading");
        result.setAttribute("aria-busy", "false");
      });
    };
    if (reduced) { textEl.textContent = ex.query; reveal(); return; }
    let n = 0; textEl.textContent = "";
    typing = setInterval(() => { textEl.textContent = ex.query.slice(0, ++n); if (n >= ex.query.length) { clearInterval(typing); setTimeout(reveal, 180); } }, 32);
  }

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
  // Play once when the empty search bar enters view; retain the completed result.
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      io.disconnect();
      if (reduced) show(); else setTimeout(show, 350);
    }
  }, { threshold: 0.8 });
  io.observe(root.querySelector(".search-box"));
}

/* ---------- Closing section: stars that are papers, with depth ----------
   Real papers from the collection are scattered as stars in the sky above the Earth (decorative
   positions, not map positions). Three depths: near stars are larger and brighter, far ones
   smaller and fainter, and on desktop each depth drifts at its own speed as the page scrolls
   (farther = slower relative to the page). They flicker in once, like the data circle's squares.
   Hover or tap a star to see its title, year and region. */
function getStars() {
  // The stars and Earth fill the shared space behind the closing section and the footer.
  const section = document.querySelector(".space"), cta = document.querySelector(".get"), canvas = section?.querySelector(".get-stars"), D = window.INVECTUS_MAP;
  if (!canvas || !D || !cta) return;
  const tip = section.querySelector(".star-tip"), earth = section.querySelector(".get-earth"), foot = section.querySelector(".foot");
  const g = canvas.getContext("2d");
  // Entrance: half a second after the section arrives, each star steps through the data
  // circle's flicker levels, more slowly and spread over about two seconds.
  const flicker = {
    starts: new Map(), until: 0,
    sync(keys, now) { this.starts = new Map(); this.until = 0; for (const k of keys) { const t = now + 500 + Math.random() * 1600; this.starts.set(k, t); this.until = Math.max(this.until, t + 600); } },
    opacity(k, now) { const t = this.starts.get(k); if (reduced || t === undefined || now >= t + 600) return 1; if (now < t) return 0; return [1, 0.2, 0.85, 0.35, 0.7, 0.5][Math.floor((now - t) / 600 * 6)]; },
    pending(now) { return now < this.until; },
  };
  const regions = new Map(D.regions.map((r) => [r.id, r.label]));
  // Phones and tablets: no parallax (too heavy under the blurred glass); stars stay still.
  const light = reduced || matchMedia("(pointer: coarse), (max-width: 1024px)").matches;
  // depth: size (px), opacity, parallax factor (share of the scroll the layer cancels out)
  const DEPTHS = [{ size: 3, alpha: 0.62, drift: 0.22, share: 0.18 }, { size: 2, alpha: 0.36, drift: 0.34, share: 0.32 }, { size: 2, alpha: 0.18, drift: 0.46, share: 0.5 }]; // whole-pixel sizes keep every star a crisp square
  const COUNT = 340;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of D.points) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const fit = { x0, y0, x1, y1 };
  const regionById = new Map(D.regions.map((r) => [r.id, r]));
  const byRegion = new Map();
  for (const pt of D.points) (byRegion.get(pt[2]) ?? byRegion.set(pt[2], []).get(pt[2])).push(pt);
  let sky = { ax: 0, ay: 0, sx: 1, sy: 1 }, pinned = null;
  const SPREAD = 2.6;
  // The Earth's horizon in the photo (top of the atmosphere glow), as a share of image height at
  // each 5% of its width, measured from assets/earth.jpg. No star is drawn below it.
  const HORIZON = [0.198, 0.203, 0.211, 0.221, 0.232, 0.242, 0.255, 0.275, 0.298, 0.322, 0.345, 0.374, 0.406, 0.439, 0.474, 0.512, 0.55, 0.592, 0.636, 0.683, 0.73];
  function horizonY(x, cr, er) {
    const t = Math.max(0, Math.min(1, (x - (er.left - cr.left)) / er.width)) * 20, i = Math.min(19, Math.floor(t));
    return er.top - cr.top + (HORIZON[i] + (HORIZON[i + 1] - HORIZON[i]) * (t - i)) * er.height;
  }
  let stars = [], W = 0, H = 0, hot = -1, frame, shown = false, visible = false, offset = 0;
  function layout() {
    const r = canvas.getBoundingClientRect(), sr = section.getBoundingClientRect();
    W = r.width; H = r.height;
    if (!W || !H) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Put the Earth's horizon just above the footer card.
    if (earth && foot) {
      // The horizon sits well above the footer card, so most of the Earth is in view.
      const eh = earth.getBoundingClientRect().height || earth.offsetWidth * 823 / 1920;
      earth.style.setProperty("--earth-top", `${foot.offsetTop - eh * 0.198 - (W < 760 ? 160 : Math.max(240, cta.offsetHeight * 0.32))}px`);
    }
    const fr = foot?.getBoundingClientRect(), footTop = fr ? fr.top - r.top : Infinity;
    const kids = [...section.querySelectorAll(".get-center > *")].map((el) => el.getBoundingClientRect());
    const copy = kids.reduce((a, b) => ({ l: Math.min(a.l, b.left - r.left), t: Math.min(a.t, b.top - r.top), rt: Math.max(a.rt, b.right - r.left), b: Math.max(a.b, b.bottom - r.top) }), { l: Infinity, t: Infinity, rt: -Infinity, b: -Infinity });
    let seed = 9071;
    const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    stars = []; pinned = null; pins = [];
    // Stars sit at their papers' real map positions, stretched across the sky above the footer,
    // so the collection's clusters read as constellations. sky maps map coords to canvas px.
    const skyH = Math.max(200, (Number.isFinite(footTop) ? footTop : H) - 40);
    sky = { ax: W * 0.02, ay: skyH * 0.03, sx: (W * 0.96) / (fit.x1 - fit.x0), sy: (skyH * 0.94) / (fit.y1 - fit.y0) };
    const jitter = (fit.x1 - fit.x0) * 0.025, MIN_GAP = W < 760 ? 10 : 16;
    for (let i = 0; i < COUNT * 4 && stars.length < COUNT; i++) {
      const p = D.points[Math.floor(rand() * D.points.length)];
      // Spread each cluster out around its region's centre (SPREAD×) so stars don't clump;
      // the region outline scales by the same amount, so it still bounds its stars.
      const reg = regionById.get(p[2]), cx = reg ? reg.x : p[0], cy = reg ? reg.y : p[1];
      const mx = cx + (p[0] - cx) * SPREAD + (rand() - 0.5) * jitter, my = cy + (p[1] - cy) * SPREAD + (rand() - 0.5) * jitter;
      const x = sky.ax + (mx - fit.x0) * sky.sx, y = sky.ay + (my - fit.y0) * sky.sy;
      if (stars.some((o) => (o.x - x) ** 2 + (o.y - y) ** 2 < MIN_GAP * MIN_GAP)) continue; // keep a minimum spacing
      const depth = DEPTHS[rand() < 0.2 ? 0 : rand() < 0.45 ? 1 : 2];
      // Near stars keep clear of the copy; faint far ones may sit closer to it.
      const pad = depth === DEPTHS[0] ? 24 : 8;
      if (x > copy.l - pad && x < copy.rt + pad && y > copy.t - pad && y < copy.b + pad) continue;
      if (y > footTop - 12) continue; // none behind the footer card
      stars.push({ x: Math.round(x), y: Math.round(y), d: depth, p, key: `s:${i}` });
    }
    // The map leaves some of the sky empty (the lower right especially). Fill any empty patch of
    // open sky with a star or two at random spots; these are still real papers, but placed freely,
    // so pinning one shows no region outline.
    const er = earth?.getBoundingClientRect(), CELL = W < 760 ? 70 : 90;
    for (let cy = 0; cy < skyH; cy += CELL) for (let cx = 0; cx < W; cx += CELL) {
      if (stars.some((o) => o.x >= cx && o.x < cx + CELL && o.y >= cy && o.y < cy + CELL)) continue;
      const n = rand() < 0.5 ? 1 : 2;
      for (let k = 0; k < n; k++) {
        const x = cx + rand() * CELL, y = cy + rand() * CELL;
        if (er && y > horizonY(x, r, er) - 24) continue;
        if (x > copy.l - 24 && x < copy.rt + 24 && y > copy.t - 16 && y < copy.b + 16) continue;
        if (stars.some((o) => (o.x - x) ** 2 + (o.y - y) ** 2 < MIN_GAP * MIN_GAP)) continue;
        const depth = DEPTHS[rand() < 0.2 ? 0 : rand() < 0.45 ? 1 : 2];
        // Use a paper from the nearest region, so this star belongs to a cluster and gets its circle.
        let near = null, nd = Infinity;
        for (const reg of D.regions) {
          const rx = sky.ax + (reg.x - fit.x0) * sky.sx, ry = sky.ay + (reg.y - fit.y0) * sky.sy, d2 = (rx - x) ** 2 + (ry - y) ** 2;
          if (d2 < nd && byRegion.get(reg.id)?.length) { nd = d2; near = reg; }
        }
        const pool = near ? byRegion.get(near.id) : D.points;
        stars.push({ x: Math.round(x), y: Math.round(y), d: depth, p: pool[Math.floor(rand() * pool.length)], key: `f:${cx}:${cy}:${k}` });
      }
    }
    stars.sort((a, b) => a.d.size - b.d.size); // far first, near on top
    if (shown) flicker.sync(stars.map((st) => st.key), performance.now());
    draw();
  }
  const at = (s) => [s.x, s.y + (light ? 0 : -offset * s.d.drift)];
  function draw() {
    cancelAnimationFrame(frame);
    const now = performance.now();
    g.clearRect(0, 0, W, H);
    const cr = canvas.getBoundingClientRect(), er = earth?.getBoundingClientRect();
    stars.forEach((s, i) => {
      const on = i === hot, [x, y] = at(s), size = on ? Math.max(4, s.d.size + 2) : s.d.size;
      s.hidden = !!er && y > horizonY(x, cr, er) - 14; // never on the Earth or its glow
      if (s.hidden) return;
      g.globalAlpha = shown ? (on ? 1 : s.d.alpha * flicker.opacity(s.key, now)) : 0;
      g.fillStyle = on ? "#6edcaa" : "#e9e4dc";
      g.fillRect(Math.round(x - size / 2), Math.round(y - size / 2), size, size);
    });
    g.globalAlpha = 1;
    // Pinned papers: a mint × and a dashed circle around the stars of its region, as in the data
    // circle. Both flicker in when pinned and flicker out when cleared.
    let busyPin = false;
    pins = pins.filter((pn) => {
      const o = pinOpacity(pn, now);
      if (pn.out && now > pn.t0 + PIN_MS) return false;
      if (now < pn.t0 + PIN_MS) busyPin = true;
      if (o > 0 && !pn.star.hidden && shown) drawPin(pn.star, o);
      return true;
    });
    if (shown && (flicker.pending(now) || busyPin)) frame = requestAnimationFrame(draw);
  }
  const PIN_MS = 300, PIN_LEVELS = [1, 0.2, 0.85, 0.35, 0.7, 0.5];
  let pins = [];
  function pinOpacity(pn, now) {
    const p = (now - pn.t0) / PIN_MS;
    if (p >= 1) return pn.out ? 0 : 1;
    if (p < 0) return pn.out ? 1 : 0;
    const level = PIN_LEVELS[Math.min(5, Math.floor(p * 6))];
    return pn.out ? Math.min(level, 1 - p) : level;
  }
  function drawPin(star, alpha) {
    const [px, py] = at(star);
    // The circle bounds this star's cluster: same-region stars near it (within 140 px, radius at most 130 px), centred on
    // their middle. It works the same for every star, large or small.
    const group = stars.filter((o) => !o.hidden && o.p[2] === star.p[2] && Math.hypot(o.x - star.x, o.y - star.y) < 140);
    if (!group.includes(star)) group.push(star);
    const gx = group.reduce((a, o) => a + o.x, 0) / group.length, gy = group.reduce((a, o) => a + o.y, 0) / group.length;
    const dy = py - star.y, rad = Math.min(130, Math.max(24, ...group.map((o) => Math.hypot(o.x - gx, o.y - gy) + 12)));
    g.globalAlpha = alpha; g.setLineDash([3, 4]); g.lineWidth = 1; g.strokeStyle = "rgba(209, 203, 194, 0.45)";
    g.beginPath(); g.arc(gx, gy + dy, rad, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]);
    g.globalAlpha = alpha; g.strokeStyle = "#6edcaa"; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(px - 5, py - 5); g.lineTo(px + 5, py + 5); g.moveTo(px + 5, py - 5); g.lineTo(px - 5, py + 5); g.stroke();
    g.globalAlpha = 1;
  }
  function showTip(star) {
    if (!star || star.hidden) { tip.hidden = true; return; }
    const r = canvas.getBoundingClientRect(), sr = section.getBoundingClientRect(), [sx, sy] = at(star);
    const [, , fine, , year, ti] = star.p;
    tip.innerHTML = `${esc(D.titles[ti])}<span>${year ?? ""}${year ? " · " : ""}${esc(regions.get(fine) ?? "")}</span>`;
    tip.hidden = false;
    tip.style.left = `${Math.min(sx + r.left - sr.left + 14, sr.width - tip.offsetWidth - 12)}px`;
    tip.style.top = `${sy + r.top - sr.top + 14}px`;
  }
  function starAt(e) {
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = -1, bd = 12 * 12;
    stars.forEach((s, i) => { if (s.hidden) return; const [sx, sy] = at(s), d = (sx - x) ** 2 + (sy - y) ** 2; if (d < bd) { bd = d; best = i; } });
    return best;
  }
  // Click a star to pin it (× and region outline); click it again to clear.
  section.addEventListener("click", (e) => {
    const i = starAt(e);
    if (i < 0) return;
    const now = performance.now(), was = pinned;
    pinned = pinned === stars[i] ? null : stars[i];
    if (was) { pins = pins.filter((pn) => pn.star !== was); pins.push({ star: was, t0: now, out: true }); }
    if (pinned) pins.push({ star: pinned, t0: now, out: false });
    draw(); showTip(pinned ?? stars[i]);
    if (!pinned) tip.hidden = true;
  });
  function pick(e) {
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = -1, bd = 12 * 12;
    stars.forEach((s, i) => { if (s.hidden) return; const [sx, sy] = at(s), d = (sx - x) ** 2 + (sy - y) ** 2; if (d < bd) { bd = d; best = i; } });
    if (best !== hot) { hot = best; draw(); }
    showTip(best >= 0 ? stars[best] : pinned);
  }
  section.addEventListener("pointermove", pick);
  section.addEventListener("pointerdown", pick);
  section.addEventListener("pointerleave", () => { hot = -1; draw(); showTip(pinned); });

  // Parallax (desktop): each star depth and the Earth drift at their own speed.
  let ticking = false;
  function parallax() {
    ticking = false;
    if (light) return;
    const r = cta.getBoundingClientRect();
    offset = r.top - innerHeight / 2 + r.height / 2;
    earth?.style.setProperty("--earth-py", `${(-offset * 0.12).toFixed(1)}px`);
    hot = -1;
    draw(); if (pinned) showTip(pinned); else tip.hidden = true;
  }
  addEventListener("scroll", () => { if (!light && visible && !ticking) { ticking = true; requestAnimationFrame(parallax); } }, { passive: true });
  new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    if (visible && !shown) { shown = true; flicker.sync(stars.map((st) => st.key), performance.now()); }
    if (visible) parallax(), draw();
  }, { threshold: 0.25 }).observe(cta);
  let rt;
  new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(layout, 100); }).observe(section);
  (document.fonts?.ready ?? Promise.resolve()).then(layout);
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
  // The wordmark drawn like the stars above it: each point gets a random depth (size and opacity),
  // points jitter slightly off the grid, and they flicker in half a second after the footer
  // arrives. After that, small blips go off now and then: a point flashes and a ring of brightness
  // spreads out from it through the letters, like a radar blip.
  const canvas = document.querySelector(".foot-mark");
  if (!canvas) return;
  const g = canvas.getContext("2d");
  const ink = "#e9e4dc", accent = "#6edcaa", STEP = 6;
  const DEPTHS = [{ size: 3, alpha: 0.5 }, { size: 2, alpha: 0.3 }, { size: 2, alpha: 0.15 }];
  const PULSE_MS = 2600, PULSE_R = 80, RING = 14;
  const flicker = {
    starts: new Map(), until: 0,
    sync(keys, now) { this.starts = new Map(); this.until = 0; for (const k of keys) { const t = now + 500 + Math.random() * 1600; this.starts.set(k, t); this.until = Math.max(this.until, t + 600); } },
    opacity(k, now) { const t = this.starts.get(k); if (reduced || t === undefined || now >= t + 600) return 1; if (now < t) return 0; return [1, 0.2, 0.85, 0.35, 0.7, 0.5][Math.floor((now - t) / 600 * 6)]; },
    pending(now) { return now < this.until; },
  };
  let dots = [], W = 0, H = 0, frame, shown = false, shownAt = 0, visible = false, pulses = [];
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
    let seed = 4211;
    const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    dots = [];
    for (let y = STEP / 2; y < H; y += STEP) for (let x = STEP / 2; x < W; x += STEP) {
      if (data[(Math.floor(y) * off.width + Math.floor(x)) * 4 + 3] <= 128) continue;
      if (rand() < 0.18) continue; // gaps, like a starfield
      const r = rand(), d = DEPTHS[r < 0.25 ? 0 : r < 0.6 ? 1 : 2];
      dots.push({ x: x + (rand() - 0.5) * 2, y: y + (rand() - 0.5) * 2, d, key: `${x},${y}` });
    }
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); canvas.style.height = `${H}px`;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (shown) flicker.sync(dots.map((p) => p.key), performance.now());
    draw();
  }
  function draw() {
    cancelAnimationFrame(frame);
    const now = performance.now();
    g.clearRect(0, 0, W, H);
    pulses = pulses.filter((p) => now < p.t0 + PULSE_MS);
    for (const p of dots) {
      // Blip: a bright centre that fades fast, and a ring that travels outward and fades as it goes.
      let boost = 0;
      for (const q of pulses) {
        const t = (now - q.t0) / PULSE_MS, dist = Math.hypot(p.x - q.x, p.y - q.y);
        if (t < 0 || dist > PULSE_R + RING) continue;
        const ease = 1 - (1 - t) ** 3, r = ease * PULSE_R;
        const ring = Math.max(0, 1 - Math.abs(dist - r) / RING) * (1 - t);
        const core = dist < 10 ? Math.max(0, 1 - t * 2.5) : 0;
        boost = Math.max(boost, ring, core);
      }
      const o = shown ? flicker.opacity(p.key, now) : 0;
      g.globalAlpha = Math.min(0.95, p.d.alpha + 0.6 * boost) * o;
      g.fillStyle = ink;
      g.fillRect(Math.round(p.x - p.d.size / 2), Math.round(p.y - p.d.size / 2), p.d.size, p.d.size);
    }
    g.globalAlpha = 1;
    if (flicker.pending(now) || pulses.length) frame = requestAnimationFrame(draw);
  }
  // Every so often, while the footer is on screen, a pulse starts at a random point of the word.
  setInterval(() => {
    // Blips start about a second into the entrance (the first points are in by then); a blip on a
    // point that has not appeared yet stays invisible there until it flickers in.
    if (reduced || !shown || !visible || !dots.length || performance.now() < shownAt + 1000) return;
    // One to three blips at a time, at random points, a little offset in time.
    const n = 1 + Math.floor(Math.random() * 3), now = performance.now();
    for (let i = 0; i < n; i++) {
      const p = dots[Math.floor(Math.random() * dots.length)];
      pulses.push({ x: p.x, y: p.y, t0: now + i * 180 + Math.random() * 300 });
    }
    draw();
  }, 900);
  new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    if (visible && !shown) { shown = true; shownAt = performance.now(); flicker.sync(dots.map((p) => p.key), shownAt); draw(); }
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

heroStars();
rimTrail();
heroMap();
agentChat();
searchDemo();
copyButtons();
getStars();
footerMark();
downloadButton();
reveals();
