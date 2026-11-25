// "The World in One Image" — Tuesday 24 November 2026.
// A single-file Node program (standard library only) that draws a newspaper
// front page summing up the day's world news and writes it as a PNG to
// /output/entry.png (MAKEFUN_OUTPUT_DIR overrides the directory).
// Everything is drawn in code: a supersampled RGB raster canvas, hand-built
// drawing primitives, and a geometric stroke font defined below.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

// ---------------------------------------------------------------- canvas
const SS = 2;                 // supersampling factor (rendered 2x, averaged down)
const W = 1024, H = 1024;     // final image size
const RW = W * SS, RH = H * SS;
const buf = new Float32Array(RW * RH * 3);

const PAPER = [247, 243, 233];
const INK = [20, 18, 14];
const GREEN = [22, 134, 72];
const NAVY = [32, 87, 158];
const GOLD = [188, 138, 10];
const RED = [188, 50, 36];
const TEAL = [13, 118, 130];
const GREY = [128, 121, 106];

function fillAll(color) {
  for (let i = 0; i < RW * RH; i++) {
    buf[i * 3] = color[0]; buf[i * 3 + 1] = color[1]; buf[i * 3 + 2] = color[2];
  }
}

function plot(rx, ry, color) {
  if (rx < 0 || ry < 0 || rx >= RW || ry >= RH) return;
  const i = (ry * RW + rx) * 3;
  buf[i] = color[0]; buf[i + 1] = color[1]; buf[i + 2] = color[2];
}

// All primitives below take design coordinates (1024x1024 space).
function fillRect(x, y, w, h, color) {
  const x0 = Math.round(x * SS), y0 = Math.round(y * SS);
  const x1 = Math.round((x + w) * SS), y1 = Math.round((y + h) * SS);
  for (let ry = y0; ry < y1; ry++) for (let rx = x0; rx < x1; rx++) plot(rx, ry, color);
}

function line(x1, y1, x2, y2, w, color) {
  const ax = x1 * SS, ay = y1 * SS, bx = x2 * SS, by = y2 * SS;
  const r = (w * SS) / 2;
  const minx = Math.floor(Math.min(ax, bx) - r - 1), maxx = Math.ceil(Math.max(ax, bx) + r + 1);
  const miny = Math.floor(Math.min(ay, by) - r - 1), maxy = Math.ceil(Math.max(ay, by) + r + 1);
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  for (let ry = miny; ry <= maxy; ry++) {
    for (let rx = minx; rx <= maxx; rx++) {
      let t = len2 === 0 ? 0 : ((rx - ax) * dx + (ry - ay) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = ax + t * dx, py = ay + t * dy;
      const ddx = rx - px, ddy = ry - py;
      if (ddx * ddx + ddy * ddy <= r * r) plot(rx, ry, color);
    }
  }
}

function strokePath(points, w, color, close = false) {
  const pts = points.slice();
  if (close && pts.length > 2) pts.push(pts[0]);
  for (let i = 0; i + 1 < pts.length; i++) line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w, color);
}

function fillCircle(cx, cy, r, color) {
  const cr = r * SS, ccx = cx * SS, ccy = cy * SS;
  const minx = Math.floor(ccx - cr - 1), maxx = Math.ceil(ccx + cr + 1);
  const miny = Math.floor(ccy - cr - 1), maxy = Math.ceil(ccy + cr + 1);
  for (let ry = miny; ry <= maxy; ry++) {
    for (let rx = minx; rx <= maxx; rx++) {
      const ddx = rx - ccx, ddy = ry - ccy;
      if (ddx * ddx + ddy * ddy <= cr * cr) plot(rx, ry, color);
    }
  }
}

function ringCircle(cx, cy, r, w, color) {
  const cr = r * SS, ccx = cx * SS, ccy = cy * SS, half = (w * SS) / 2;
  const minx = Math.floor(ccx - cr - half - 1), maxx = Math.ceil(ccx + cr + half + 1);
  const miny = Math.floor(ccy - cr - half - 1), maxy = Math.ceil(ccy + cr + half + 1);
  for (let ry = miny; ry <= maxy; ry++) {
    for (let rx = minx; rx <= maxx; rx++) {
      const ddx = rx - ccx, ddy = ry - ccy;
      const d = Math.sqrt(ddx * ddx + ddy * ddy);
      if (Math.abs(d - cr) <= half) plot(rx, ry, color);
    }
  }
}

function fillPoly(points, color) {
  const pts = points.map(([x, y]) => [x * SS, y * SS]);
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const [x, y] of pts) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
  minx = Math.floor(minx); miny = Math.floor(miny); maxx = Math.ceil(maxx); maxy = Math.ceil(maxy);
  for (let ry = miny; ry <= maxy; ry++) {
    for (let rx = minx; rx <= maxx; rx++) {
      // even-odd ray casting
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > ry) !== (yj > ry) && rx < ((xj - xi) * (ry - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) plot(rx, ry, color);
    }
  }
}

function arcPoints(cx, cy, rx, ry, a0, a1, step = 10) {
  const pts = [];
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / step));
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + (a1 - a0) * (i / n)) * Math.PI) / 180;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

function roundRectPath(x, y, w, h, r) {
  return [
    ...arcPoints(x + r, y + r, r, r, 180, 270),
    ...arcPoints(x + w - r, y + r, r, r, 270, 360),
    ...arcPoints(x + w - r, y + h - r, r, r, 0, 90),
    ...arcPoints(x + r, y + h - r, r, r, 90, 180),
  ];
}

// ---------------------------------------------------------------- PNG out
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function encodePNG() {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  let o = 0;
  for (let y = 0; y < H; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * RW + (x * SS + sx)) * 3;
          r += buf[i]; g += buf[i + 1]; b += buf[i + 2];
        }
      }
      const n = SS * SS;
      raw[o++] = Math.round(r / n); raw[o++] = Math.round(g / n); raw[o++] = Math.round(b / n);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- font
// Glyphs live on a 6-wide, 9-tall grid (y grows downward, 0 = cap top,
// 9 = baseline). Each glyph is a list of strokes; each stroke is a polyline.
const FONT = {
  A: [[[0, 9], [3, 0], [6, 9]], [[1.4, 6.1], [4.6, 6.1]]],
  B: [
    [[0, 0], [0, 9]],
    [[0, 0], [3.1, 0], ...arcPoints(3.1, 2.25, 1.95, 2.25, -90, 90), [0, 4.5]],
    [[0, 4.5], [3.3, 4.5], ...arcPoints(3.3, 6.75, 2.15, 2.25, -90, 90), [0, 9]],
  ],
  C: [[...arcPoints(3.3, 4.5, 3.0, 4.5, -55, -305)]],
  D: [
    [[0, 0], [0, 9]],
    [[0, 0], [2.5, 0], ...arcPoints(2.5, 4.5, 3.1, 4.5, -90, 90), [0, 9]],
  ],
  E: [[[6, 0], [0, 0], [0, 9], [6, 9]], [[0, 4.5], [4.5, 4.5]]],
  F: [[[6, 0], [0, 0], [0, 9]], [[0, 4.5], [4.3, 4.5]]],
  G: [[...arcPoints(3.3, 4.5, 3.0, 4.5, -55, -300)], [[3.7, 5.1], [6.05, 5.1], [6.05, 7.9]]],
  H: [[[0, 0], [0, 9]], [[6, 0], [6, 9]], [[0, 4.5], [6, 4.5]]],
  I: [[[3, 0], [3, 9]], [[1.1, 0], [4.9, 0]], [[1.1, 9], [4.9, 9]]],
  J: [[[6, 0], [6, 6.5], ...arcPoints(3.7, 6.5, 2.3, 2.5, 0, 170)], [[3.9, 0], [6, 0]]],
  K: [[[0, 0], [0, 9]], [[6, 0], [0.7, 4.9]], [[1.8, 3.9], [6, 9]]],
  L: [[[0, 0], [0, 9], [6, 9]]],
  M: [[[0, 9], [0, 0], [3, 5.6], [6, 0], [6, 9]]],
  N: [[[0, 9], [0, 0], [6, 9], [6, 0]]],
  O: [[...arcPoints(3, 4.5, 3, 4.5, 0, 360)]],
  P: [[[0, 9], [0, 0], [3.1, 0], ...arcPoints(3.1, 2.4, 2.45, 2.4, -90, 90), [0, 4.8]]],
  Q: [[...arcPoints(3, 4.5, 3, 4.5, 0, 360)], [[3.8, 6.2], [6.2, 9.2]]],
  R: [
    [[0, 9], [0, 0], [3.1, 0], ...arcPoints(3.1, 2.4, 2.45, 2.4, -90, 90), [0, 4.8]],
    [[3.3, 4.8], [6, 9]],
  ],
  S: [[[5.3, 1.5], [4.6, 0.5], [3.2, 0.05], [1.9, 0.3], [1.0, 1.3], [1.05, 2.6], [1.9, 3.6], [3.3, 4.4], [4.7, 5.3], [5.35, 6.5], [5.0, 8.0], [3.9, 8.95], [2.4, 9.05], [1.2, 8.5], [0.7, 7.5]]],
  T: [[[0, 0], [6, 0]], [[3, 0], [3, 9]]],
  U: [[[0, 0], [0, 6.1], ...arcPoints(3, 6.1, 3, 2.9, 180, 90), [6, 6.1], [6, 0]]],
  V: [[[0, 0], [3, 9], [6, 0]]],
  W: [[[0, 0], [1.5, 9], [3, 3.6], [4.5, 9], [6, 0]]],
  X: [[[0, 0], [6, 9]], [[6, 0], [0, 9]]],
  Y: [[[0, 0], [3, 4.4], [6, 0]], [[3, 4.4], [3, 9]]],
  Z: [[[0, 0], [6, 0], [0, 9], [6, 9]]],
  0: [[...arcPoints(3, 4.5, 2.7, 4.5, 0, 360)]],
  1: [[[1.7, 1.7], [3.4, 0], [3.4, 9]], [[1.2, 9], [5, 9]]],
  2: [[[1.0, 2.7], [1.2, 1.2], [2.4, 0.2], [4.1, 0.15], [5.2, 1.2], [5.05, 2.9], [3.7, 4.7], [0.7, 9], [5.7, 9]]],
  3: [[[1.0, 1.5], [2.3, 0.2], [4.0, 0.3], [5.0, 1.7], [4.5, 3.3], [3.1, 4.2], [4.5, 4.9], [5.3, 6.4], [4.8, 8.2], [3.2, 9.1], [1.6, 8.9], [0.7, 7.8]]],
  4: [[[3.9, 9], [3.9, 0], [0.3, 6.3], [6, 6.3]]],
  5: [[[5.6, 0], [1.1, 0], [0.85, 3.5], [2.7, 3.05], [4.5, 3.8], [5.3, 5.7], [4.7, 7.9], [3.0, 9.05], [1.4, 8.7], [0.6, 7.5]]],
  6: [
    [...arcPoints(3, 6.3, 2.7, 2.7, 0, 360)],
    [[5.35, 1.9], [4.2, 0.4], [2.4, 0.5], [1.2, 2.2], [0.5, 4.9], [0.32, 6.3]],
  ],
  7: [[[0, 0], [6, 0], [2.7, 9]]],
  8: [
    [...arcPoints(3, 2.35, 2.15, 2.35, 0, 360)],
    [...arcPoints(3, 6.55, 2.55, 2.45, 0, 360)],
  ],
  9: [
    [...arcPoints(3, 2.7, 2.7, 2.7, 0, 360)],
    [[5.68, 2.9], [5.6, 5.9], [4.7, 8.2], [3.2, 9.2], [1.6, 8.8]],
  ],
  ' ': [],
  '.': [[[3, 8.72], [3, 8.8]]],
  ',': [[[3.3, 8.4], [2.8, 9.7]]],
  '%': [
    [...arcPoints(1.55, 1.9, 1.25, 1.7, 0, 360)],
    [[5.3, 0.3], [0.7, 8.9]],
    [...arcPoints(4.45, 7.1, 1.25, 1.7, 0, 360)],
  ],
  '+': [[[3, 2], [3, 7]], [[1, 4.5], [5, 4.5]]],
  '·': [[[3, 4.38], [3, 4.5]]],
  '—': [[[0.2, 4.5], [5.8, 4.5]]],
  '-': [[[1.3, 4.5], [4.7, 4.5]]],
  "'": [[[3.1, 0.3], [2.7, 2.1]]],
  ':': [[[3, 2.38], [3, 2.5]], [[3, 6.58], [3, 6.7]]],
  '/': [[[1.1, 9], [5.2, 0]]],
  '&': [
    [[4.9, 1.5], [4.0, 0.25], [2.5, 0.3], [1.95, 1.6], [2.6, 3.0], [5.9, 8.9]],
    [[2.6, 3.0], [1.3, 4.5], [1.05, 6.5], [2.0, 8.55], [3.9, 8.9], [5.3, 7.7], [5.5, 6.0], [4.7, 5.0], [3.6, 4.9]],
  ],
  '!': [[[3, 0], [3, 6.2]], [[3, 8.72], [3, 8.8]]],
  '?': [[[0, 0], [6, 0], [6, 9], [0, 9], [0, 0]]], // fallback box for unknown glyphs
};

function glyphFor(ch) {
  return FONT[ch] !== undefined ? FONT[ch] : FONT['?'];
}

function advanceOf(size, ls) {
  return size * (6 / 9) + size * ls;
}

function textWidth(text, size, ls = 0.14, xScale = 1) {
  const t = text.toUpperCase();
  if (t.length === 0) return 0;
  return (t.length * advanceOf(size, ls) - size * ls) * xScale;
}

// Draws text with its cap top at y. Returns the drawn width.
function drawText(text, x, y, opts = {}) {
  const size = opts.size ?? 24;
  const color = opts.color ?? INK;
  const weight = opts.weight ?? 0.155;
  const align = opts.align ?? 'left';
  const ls = opts.ls ?? 0.14;
  const xScale = opts.xScale ?? 1;
  const t = text.toUpperCase();
  const total = textWidth(t, size, ls, xScale);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  const unit = size / 9;
  const lw = Math.max(1.1, size * weight);
  for (const ch of t) {
    const glyph = glyphFor(ch);
    for (const stroke of glyph) {
      const pts = stroke.map(([gx, gy]) => [cx + gx * unit * xScale, y + gy * unit]);
      strokePath(pts, lw, color);
    }
    cx += advanceOf(size, ls) * xScale;
  }
  return total;
}

function wrapText(text, size, maxW, ls = 0.14) {
  const words = text.toUpperCase().split(' ');
  const lines = [];
  let cur = '';
  for (const word of words) {
    const trial = cur === '' ? word : cur + ' ' + word;
    if (cur !== '' && textWidth(trial, size, ls) > maxW) {
      lines.push(cur);
      cur = word;
    } else {
      cur = trial;
    }
  }
  if (cur !== '') lines.push(cur);
  return lines;
}

// Largest size (<= startSize) whose wrap fits maxLines lines; returns size + lines.
function fitBlock(text, maxW, maxLines, startSize, ls = 0.14) {
  let size = startSize;
  let lines = wrapText(text, size, maxW, ls);
  while (lines.length > maxLines && size > 8) {
    size -= 1;
    lines = wrapText(text, size, maxW, ls);
  }
  return { size, lines };
}

// ---------------------------------------------------------------- icons
function rectOutline(x, y, w, h, wdt, color) {
  strokePath([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], wdt, color, true);
}

function waveLine(x, y, len, amp, w, color) {
  const pts = [];
  for (let t = 0; t <= len; t += 6) pts.push([x + t, y + amp * Math.sin(t / 13)]);
  strokePath(pts, w, color);
}

function iconTanker(ix, iy, accent) {
  fillRect(ix + 18, iy + 58, 30, 16, INK);
  fillRect(ix + 52, iy + 58, 30, 16, INK);
  fillRect(ix + 92, iy + 40, 20, 34, INK);
  fillRect(ix + 97, iy + 47, 10, 7, PAPER);
  line(ix + 24, iy + 74, ix + 24, iy + 44, 4, INK);
  fillPoly([[ix + 24, iy + 44], [ix + 39, iy + 48.5], [ix + 24, iy + 53]], accent);
  fillPoly([[ix + 8, iy + 74], [ix + 126, iy + 74], [ix + 112, iy + 98], [ix + 22, iy + 98]], INK);
  fillRect(ix + 32, iy + 82, 70, 5, accent);
  // sea mine on a chain, lower right
  const mx = ix + 102, my = iy + 114;
  for (const [px, py] of [[96, 92], [99, 99], [102, 105]]) fillCircle(ix + px, iy + py, 1.9, INK);
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    line(mx, my, mx + 15.5 * Math.cos(a), my + 15.5 * Math.sin(a), 3.5, accent);
  }
  fillCircle(mx, my, 10, accent);
  fillCircle(mx - 3, my - 3, 3, PAPER);
  waveLine(ix + 4, iy + 122, 54, 3, 3, accent);
}

function iconScales(ix, iy, accent) {
  const cx = ix + 67;
  line(cx, iy + 24, cx, iy + 108, 6, INK);
  line(cx - 54, iy + 24, cx + 54, iy + 24, 6, INK);
  fillCircle(cx, iy + 13, 5.5, accent);
  fillCircle(cx, iy + 24, 4.5, INK);
  for (const s of [-1, 1]) {
    const px = cx + s * 54;
    line(px, iy + 24, px - 15, iy + 56, 3, INK);
    line(px, iy + 24, px + 15, iy + 56, 3, INK);
    strokePath(arcPoints(px, iy + 56, 17, 9, 0, 180), 4.5, INK);
    line(px - 17, iy + 56, px + 17, iy + 56, 4.5, INK);
    fillCircle(px, iy + 47, 3.5, accent);
  }
  line(cx, iy + 108, cx, iy + 114, 6, INK);
  line(cx - 28, iy + 116, cx + 28, iy + 116, 7, INK);
}

function iconRocket(ix, iy, accent) {
  const cx = ix + 67;
  fillPoly([[cx - 17, iy + 58], [cx - 37, iy + 92], [cx - 17, iy + 92]], accent);
  fillPoly([[cx + 17, iy + 58], [cx + 37, iy + 92], [cx + 17, iy + 92]], accent);
  fillPoly([[cx - 8, iy + 94], [cx + 8, iy + 94], [cx, iy + 121]], accent);
  const body = [
    [cx, iy + 4], [cx + 10, iy + 18], [cx + 16, iy + 40], [cx + 18, iy + 66],
    [cx + 18, iy + 92], [cx - 18, iy + 92], [cx - 18, iy + 66], [cx - 16, iy + 40], [cx - 10, iy + 18],
  ];
  fillPoly(body, PAPER);
  strokePath(body, 5, INK, true);
  fillCircle(cx, iy + 42, 8.5, accent);
  fillCircle(cx, iy + 42, 3.4, PAPER);
  line(cx - 18, iy + 78, cx + 18, iy + 78, 4, INK);
}

function iconDrone(ix, iy, accent) {
  const cx = ix + 67;
  ringCircle(cx - 38, iy + 20, 13, 4, INK);
  ringCircle(cx + 38, iy + 20, 13, 4, INK);
  fillCircle(cx - 38, iy + 20, 3, INK);
  fillCircle(cx + 38, iy + 20, 3, INK);
  line(cx - 12, iy + 34, cx - 33, iy + 23, 5, INK);
  line(cx + 12, iy + 34, cx + 33, iy + 23, 5, INK);
  const bodyPts = roundRectPath(cx - 17, iy + 28, 34, 16, 6);
  fillPoly(bodyPts, INK);
  fillCircle(cx, iy + 51, 5, accent);
  strokePath(arcPoints(cx, iy + 56, 9, 9, 25, 155), 3, accent);
  strokePath(arcPoints(cx, iy + 56, 16, 16, 25, 155), 3, accent);
  fillRect(ix + 54, iy + 86, 24, 16, INK);
  fillRect(ix + 60, iy + 91, 12, 6, PAPER);
  line(ix + 40, iy + 102, ix + 40, iy + 82, 4, INK);
  fillPoly([[ix + 16, iy + 102], [ix + 118, iy + 102], [ix + 106, iy + 120], [ix + 28, iy + 120]], INK);
  fillRect(ix + 36, iy + 108, 62, 4, accent);
  waveLine(ix + 8, iy + 127, 118, 3, 3, accent);
}

// ---------------------------------------------------------------- page
fillAll(PAPER);

// frame
rectOutline(26, 26, 972, 972, 3.5, INK);
rectOutline(37, 37, 950, 950, 1.2, INK);

// masthead
{
  let size = 54;
  while (size > 10 && textWidth('THE WORLD IN ONE IMAGE', size, 0.1) > 884) size -= 1;
  drawText('THE WORLD IN ONE IMAGE', 512, 58, { size, align: 'center', weight: 0.175, ls: 0.1 });
  line(48, 134, 976, 134, 3.4, INK);
  line(48, 141, 976, 141, 1.1, INK);
}

// dateline
drawText('TUESDAY 24 NOVEMBER 2026', 48, 154, { size: 16.5, weight: 0.15 });
drawText('GLOBAL EDITION', 976, 154, { size: 16.5, weight: 0.15, align: 'right' });
line(48, 186, 976, 186, 1.1, INK);

// hero panel
rectOutline(48, 200, 928, 308, 2.6, INK);
drawText('TECH · MARKETS', 74, 220, { size: 15, weight: 0.14, ls: 0.3 });
{
  const head = fitBlock('NVIDIA REINSTATES JENSEN HUANG AS CEO', 516, 3, 47);
  let hy = 248;
  for (const ln of head.lines) {
    drawText(ln, 74, hy, { size: head.size, weight: 0.16 });
    hy += head.size * 1.22;
  }
  fillRect(74, hy + 6, 64, 5, GREEN);
  let cap = 20;
  while (cap > 8 && textWidth('TRUMP INTERVENES · SHARES SOAR 31%', cap) > 516) cap -= 0.5;
  drawText('TRUMP INTERVENES · SHARES SOAR 31%', 74, 452, { size: cap, weight: 0.15 });
}
// hero illustration: rising arrow passing behind the chip
strokePath([[644, 476], [748, 398], [800, 424], [934, 268]], 9, GREEN);
line(934, 268, 899, 272, 9, GREEN);
line(934, 268, 927, 303, 9, GREEN);
{
  // pins
  for (let i = 0; i < 7; i++) {
    const px = 722 + i * 24;
    line(px, 244, px, 216, 6, INK);
    line(px, 428, px, 456, 6, INK);
    const py = 268 + i * 24;
    line(698, py, 670, py, 6, INK);
    line(882, py, 910, py, 6, INK);
  }
  const chip = roundRectPath(698, 244, 184, 184, 18);
  fillPoly(chip, PAPER);
  strokePath(chip, 7, INK, true);
  strokePath(roundRectPath(742, 288, 96, 96, 10), 3.5, INK, true);
  drawText('AI', 790, 313, { size: 44, align: 'center', weight: 0.17 });
}
// EXTRA ribbon, tilted across the hero panel's top-right corner
{
  const rcx = 908, rcy = 228, rl = 104, rh = 28;
  const ra = (12 * Math.PI) / 180;
  const ux = Math.cos(ra), uy = Math.sin(ra);
  const nx = -uy, ny = ux;
  const corner = (su, sn) => [
    rcx + su * (rl / 2) * ux + sn * (rh / 2) * nx,
    rcy + su * (rl / 2) * uy + sn * (rh / 2) * ny,
  ];
  fillPoly([corner(1, 1), corner(1, -1), corner(-1, -1), corner(-1, 1)], RED);
  const word = 'EXTRA';
  const wsize = 17;
  const unit = wsize / 9;
  let pen = -textWidth(word, wsize, 0.14) / 2;
  for (const ch of word) {
    for (const stroke of glyphFor(ch)) {
      const pts = stroke.map(([gx, gy]) => {
        const lx = pen + gx * unit, ly = (gy - 4.5) * unit;
        return [rcx + lx * ux - ly * uy, rcy + lx * uy + ly * ux];
      });
      strokePath(pts, Math.max(1.1, wsize * 0.16), PAPER);
    }
    pen += advanceOf(wsize, 0.14);
  }
}

// news panels
function panel(x, y, headline, iconFn, accent) {
  rectOutline(x, y, 448, 166, 2.2, INK);
  iconFn(x + 16, y + 18, accent);
  const block = fitBlock(headline, 264, 5, 25);
  const lh = block.size * 1.24;
  let hy = y + Math.max(14, (166 - block.lines.length * lh) / 2 - 2);
  for (const ln of block.lines) {
    drawText(ln, x + 166, hy, { size: block.size, weight: 0.155 });
    hy += lh;
  }
}
panel(48, 528, 'TANKERS HIT MINES IN HORMUZ — IRAN REFUSES TALKS', iconTanker, NAVY);
panel(512, 528, '14 NATIONS BACK ICJ: MYANMAR COMMITTED GENOCIDE OF ROHINGYA', iconScales, GOLD);
panel(48, 710, "SHENZHOU-24: PAKISTAN'S FIRST ASTRONAUT FLIES TO TIANGONG", iconRocket, RED);
panel(512, 710, "UKRAINE'S SEA DRONES SINK RUSSIAN WARSHIP IN LIBYAN PORT", iconDrone, TEAL);

// ticker
fillRect(48, 902, 928, 62, INK);
drawText('S&P 500 +4.7% · NASDAQ +6.5% · NEPAL QUAKE 5.6', 512, 911, { size: 18.5, color: PAPER, align: 'center', weight: 0.15 });
drawText('UN CHIEF: GLOBAL AI RULES WITHIN A YEAR', 512, 938, { size: 18.5, color: PAPER, align: 'center', weight: 0.15 });

// folio footer, centered in the strip between the ticker and the frame
drawText('PAGE ONE · ALL THE NEWS IN A SINGLE PICTURE', 512, 968, { size: 12, color: GREY, align: 'center', weight: 0.15, ls: 0.3 });

// ---------------------------------------------------------------- output
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
const png = encodePNG();
writeFileSync(join(outDir, 'entry.png'), png);
console.log('wrote', join(outDir, 'entry.png'), png.length, 'bytes');
