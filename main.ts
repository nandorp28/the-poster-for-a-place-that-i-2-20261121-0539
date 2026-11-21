// VELMARA — a travel poster for a place that isn't there.
// main.ts: draws the poster procedurally (no assets, no network) and
// writes a PNG to /output/entry.png (or $OUTPUT_DIR/entry.png locally).
// Node 22, standard library only.

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const W = 1024;
const H = 1024;
const HORIZON = 640;

// ---------------------------------------------------------------------------
// Framebuffer
// ---------------------------------------------------------------------------

const px = new Uint8Array(W * H * 3);

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

type RGB = [number, number, number];

function mix(c1: RGB, c2: RGB, t: number): RGB {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

function put(x: number, y: number, c: RGB, alpha = 1): void {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || ix >= W || iy < 0 || iy >= H) return;
  const o = (iy * W + ix) * 3;
  if (alpha >= 1) {
    px[o] = c[0];
    px[o + 1] = c[1];
    px[o + 2] = c[2];
  } else {
    px[o] = Math.round(lerp(px[o], c[0], alpha));
    px[o + 1] = Math.round(lerp(px[o + 1], c[1], alpha));
    px[o + 2] = Math.round(lerp(px[o + 2], c[2], alpha));
  }
}

function disc(cx: number, cy: number, r: number, c: RGB, alpha = 1): void {
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(H - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) put(x, y, c, alpha);
    }
  }
}

// A thick line drawn by stamping discs along the segment (round caps).
function thickLine(x0: number, y0: number, x1: number, y1: number, w: number, c: RGB, alpha = 1): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / 0.6));
  const r = w / 2;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    disc(x0 + dx * t, y0 + dy * t, r, c, alpha);
  }
}

// Scanline polygon fill (even-odd, integer edges).
function polygon(points: Array<[number, number]>, c: RGB, alpha = 1): void {
  let minY = H;
  let maxY = 0;
  for (const [, y] of points) {
    minY = Math.min(minY, Math.floor(y));
    maxY = Math.max(maxY, Math.ceil(y));
  }
  minY = clamp(minY, 0, H - 1);
  maxY = clamp(maxY, 0, H - 1);
  for (let y = minY; y <= maxY; y++) {
    const xs: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[(i + 1) % points.length];
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
        xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = clamp(Math.ceil(xs[k]), 0, W - 1);
      const xb = clamp(Math.floor(xs[k + 1]), 0, W - 1);
      for (let x = xa; x <= xb; x++) put(x, y, c, alpha);
    }
  }
}

// Vertical gradient over a y-range, defined by colour stops.
function vGradient(y0: number, y1: number, stops: Array<[number, RGB]>): void {
  for (let y = y0; y < y1; y++) {
    const t = (y - y0) / (y1 - y0);
    let c: RGB = stops[stops.length - 1][1];
    for (let i = 0; i + 1 < stops.length; i++) {
      const [t0, c0] = stops[i];
      const [t1, c1] = stops[i + 1];
      if (t >= t0 && t <= t1) {
        c = mix(c0, c1, (t - t0) / (t1 - t0));
        break;
      }
    }
    const row = y * W * 3;
    for (let x = 0; x < W; x++) {
      const o = row + x * 3;
      px[o] = c[0];
      px[o + 1] = c[1];
      px[o + 2] = c[2];
    }
  }
}

// Deterministic pseudo-random (mulberry32) so the poster is reproducible.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Sky, sun, stars
// ---------------------------------------------------------------------------

const SKY: Array<[number, RGB]> = [
  [0.0, [26, 30, 76]],
  [0.35, [89, 66, 128]],
  [0.58, [181, 88, 112]],
  [0.8, [232, 141, 92]],
  [1.0, [247, 178, 94]],
];
vGradient(0, HORIZON, SKY);

// Stars in the upper sky.
{
  const rand = rng(20261121);
  for (let i = 0; i < 150; i++) {
    const x = rand() * W;
    const y = rand() * 360;
    const a = 0.25 + rand() * 0.6 * (1 - y / 420);
    const r = rand() < 0.12 ? 2 : 1;
    disc(x, y, r, [255, 244, 214], a);
  }
}

// Low sun with a warm glow, sitting just above the horizon.
const SUN: [number, number] = [392, 578];
for (const [r, a] of [
  [210, 0.1],
  [160, 0.14],
  [118, 0.2],
] as Array<[number, number]>) {
  disc(SUN[0], SUN[1], r, [255, 176, 92], a);
}
disc(SUN[0], SUN[1], 66, [255, 214, 138], 1);
disc(SUN[0], SUN[1], 58, [255, 228, 168], 1);

// A few birds, simple chevrons drifting high in the dusk.
for (const [bx, by, s] of [
  [180, 300, 14],
  [232, 268, 11],
  [700, 240, 13],
  [756, 282, 10],
  [812, 222, 12],
] as Array<[number, number, number]>) {
  thickLine(bx - s, by, bx, by - s * 0.55, 3, [38, 28, 66], 0.85);
  thickLine(bx, by - s * 0.55, bx + s, by, 3, [38, 28, 66], 0.85);
}

// ---------------------------------------------------------------------------
// Distant mountains along the horizon
// ---------------------------------------------------------------------------

polygon(
  [
    [0, HORIZON],
    [110, 602],
    [225, 630],
    [330, 586],
    [430, 624],
    [520, 600],
    [640, 632],
    [760, 598],
    [880, 626],
    [1024, 608],
    [1024, HORIZON],
  ],
  [52, 38, 82],
);

// ---------------------------------------------------------------------------
// Sea
// ---------------------------------------------------------------------------

const SEA: Array<[number, RGB]> = [
  [0.0, [214, 128, 96]],
  [0.25, [132, 74, 106]],
  [0.6, [58, 44, 88]],
  [1.0, [30, 24, 64]],
];
vGradient(HORIZON, H, SEA);

// The sun's path on the water: a widening column of gold dashes.
{
  const rand = rng(777);
  for (let y = HORIZON + 8; y < H - 30; y += 9) {
    const depth = (y - HORIZON) / (H - HORIZON);
    const half = 26 + depth * 150;
    const cx = SUN[0] + (rand() - 0.5) * 30;
    const wHalf = half * (0.35 + rand() * 0.65);
    const a = 0.5 * (1 - depth * 0.75);
    for (let x = Math.floor(cx - wHalf); x <= cx + wHalf; x++) {
      put(x, y, [255, 196, 110], a);
      if (rand() < 0.5) put(x, y + 1, [255, 214, 140], a * 0.6);
    }
  }
  // Shimmer strokes across the rest of the sea.
  for (let i = 0; i < 260; i++) {
    const x = rand() * W;
    const y = HORIZON + 20 + rand() * (H - HORIZON - 60);
    const len = 8 + rand() * 42;
    const warm = rand() < 0.6;
    const c: RGB = warm ? [255, 190, 120] : [190, 160, 220];
    for (let k = 0; k < len; k++) put(x + k, y, c, 0.08 + rand() * 0.12);
  }
}

// ---------------------------------------------------------------------------
// The headland and the Lantern Spire — Velmara's one landmark
// ---------------------------------------------------------------------------

// Rocky promontory rising out of the sea on the right.
polygon(
  [
    [1024, HORIZON + 6],
    [1024, 440],
    [985, 458],
    [945, 482],
    [912, 524],
    [888, 566],
    [868, 612],
    [850, HORIZON + 6],
  ],
  [28, 18, 54],
);
// A warm rim of last light along the cliff's top edge.
thickLine(1024, 440, 985, 458, 4, [255, 178, 110], 0.7);
thickLine(985, 458, 945, 482, 4, [255, 178, 110], 0.55);
thickLine(945, 482, 912, 524, 4, [255, 178, 110], 0.4);

// The spire: a tall tapered tower crowned by a beacon.
const SPIRE_X = 940;
const SPIRE_TOP = 200;
const SPIRE_BASE = 488;
polygon(
  [
    [SPIRE_X - 24, SPIRE_BASE],
    [SPIRE_X - 13, SPIRE_TOP + 26],
    [SPIRE_X + 13, SPIRE_TOP + 26],
    [SPIRE_X + 24, SPIRE_BASE],
  ],
  [42, 28, 70],
);
thickLine(SPIRE_X - 24, SPIRE_BASE, SPIRE_X - 13, SPIRE_TOP + 26, 3, [255, 190, 120], 0.5);
// Spiral of lantern windows winding up the tower.
for (let i = 0; i < 26; i++) {
  const t = i / 25;
  const y = SPIRE_BASE - 22 - t * (SPIRE_BASE - SPIRE_TOP - 70);
  const halfW = lerp(20, 10, t);
  const x = SPIRE_X + Math.sin(t * Math.PI * 4.2) * halfW * 0.62;
  disc(x, y, 6.5, [255, 190, 110], 0.25);
  disc(x, y, 3.6, [255, 207, 125], 1);
}
// Beacon star at the crown.
disc(SPIRE_X, SPIRE_TOP, 26, [255, 226, 150], 0.3);
disc(SPIRE_X, SPIRE_TOP, 14, [255, 240, 180], 0.55);
disc(SPIRE_X, SPIRE_TOP, 8, [255, 246, 205], 1);
thickLine(SPIRE_X - 20, SPIRE_TOP, SPIRE_X + 20, SPIRE_TOP, 2.5, [255, 246, 205], 0.9);
thickLine(SPIRE_X, SPIRE_TOP - 20, SPIRE_X, SPIRE_TOP + 20, 2.5, [255, 246, 205], 0.9);

// ---------------------------------------------------------------------------
// Boats with lanterns, and foreground rocks
// ---------------------------------------------------------------------------

function sailboat(bx: number, by: number, s: number, sail: RGB): void {
  // Hull.
  polygon(
    [
      [bx - 34 * s, by],
      [bx + 34 * s, by],
      [bx + 22 * s, by + 12 * s],
      [bx - 22 * s, by + 12 * s],
    ],
    [24, 16, 48],
  );
  // Mast and sail.
  thickLine(bx, by, bx, by - 52 * s, 3, [24, 16, 48], 1);
  polygon(
    [
      [bx + 3 * s, by - 50 * s],
      [bx + 3 * s, by - 6 * s],
      [bx + 34 * s, by - 6 * s],
    ],
    sail,
  );
  // A lantern at the stern.
  disc(bx - 30 * s, by - 4 * s, 4, [255, 205, 120], 0.35);
  disc(bx - 30 * s, by - 4 * s, 2.2, [255, 216, 140], 1);
}
sailboat(268, 812, 1.0, [245, 226, 196]);
sailboat(618, 878, 0.8, [232, 160, 130]);

// Foreground rocks, bottom left, with two lantern posts.
polygon(
  [
    [0, H],
    [0, 948],
    [96, 912],
    [196, 946],
    [252, 986],
    [268, H],
  ],
  [22, 14, 44],
);
for (const [lx, lh] of [
  [84, 62],
  [168, 46],
] as Array<[number, number]>) {
  const baseY = 936;
  thickLine(lx, baseY, lx, baseY - lh, 4, [30, 20, 52], 1);
  disc(lx, baseY - lh - 6, 9, [255, 196, 110], 0.3);
  disc(lx, baseY - lh - 6, 5, [255, 214, 130], 1);
}

// ---------------------------------------------------------------------------
// Poster frame
// ---------------------------------------------------------------------------

function frameRect(inset: number, w: number, c: RGB, alpha = 1): void {
  thickLine(inset, inset, W - inset, inset, w, c, alpha);
  thickLine(W - inset, inset, W - inset, H - inset, w, c, alpha);
  thickLine(W - inset, H - inset, inset, H - inset, w, c, alpha);
  thickLine(inset, H - inset, inset, inset, w, c, alpha);
}
frameRect(26, 5, [245, 233, 200], 0.95);
frameRect(40, 2, [245, 233, 200], 0.6);

// ---------------------------------------------------------------------------
// The name — hand-drawn vector capitals, drawn stroke by stroke.
// ---------------------------------------------------------------------------

// Each glyph: list of polylines on a 10 x 14 grid (x 0..10, y 0..14).
const GLYPHS: Record<string, Array<Array<[number, number]>>> = {
  V: [[[0, 0], [5, 14], [10, 0]]],
  E: [
    [[10, 0], [0, 0], [0, 14], [10, 14]],
    [[0, 7], [8, 7]],
  ],
  L: [[[0, 0], [0, 14], [10, 14]]],
  M: [[[0, 14], [0, 0], [5, 7], [10, 0], [10, 14]]],
  A: [
    [[0, 14], [5, 0], [10, 14]],
    [[2.8, 8], [7.2, 8]],
  ],
  R: [
    [[0, 14], [0, 0], [8, 0], [10, 2], [10, 6], [8, 8], [0, 8]],
    [[6.5, 8], [10, 14]],
  ],
};

function drawWord(word: string, topY: number, capH: number, c: RGB, alpha = 1): void {
  const unit = capH / 14;
  const adv = 13 * unit;
  const totalW = word.length * 10 * unit + (word.length - 1) * 3 * unit;
  let x = (W - totalW) / 2;
  const stroke = capH * 0.115;
  for (const ch of word) {
    const glyph = GLYPHS[ch];
    if (!glyph) continue;
    for (const line of glyph) {
      for (let i = 0; i + 1 < line.length; i++) {
        const [gx0, gy0] = line[i];
        const [gx1, gy1] = line[i + 1];
        thickLine(
          x + gx0 * unit,
          topY + gy0 * unit,
          x + gx1 * unit,
          topY + gy1 * unit,
          stroke,
          c,
          alpha,
        );
      }
    }
    x += adv;
  }
}

// Soft shadow first, then the cream lettering.
drawWord("VELMARA", 108, 118, [24, 18, 56], 0.55);
drawWord("VELMARA", 102, 118, [255, 243, 217], 1);

// A thin rule under the name, with a small diamond at its centre.
thickLine(322, 252, 702, 252, 3, [255, 243, 217], 0.85);
polygon(
  [
    [512, 244],
    [520, 252],
    [512, 260],
    [504, 252],
  ],
  [255, 243, 217],
);

// ---------------------------------------------------------------------------
// PNG encoding (zlib, filter 0) and output
// ---------------------------------------------------------------------------

const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(): Buffer {
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter: none
    raw.set(px.subarray(y * W * 3, (y + 1) * W * 3), y * (1 + W * 3) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outDir = process.env.OUTPUT_DIR ?? "/output";
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "entry.png");
const png = encodePng();
writeFileSync(outPath, png);
console.log(`wrote ${outPath} (${png.length} bytes, ${W}x${H})`);
