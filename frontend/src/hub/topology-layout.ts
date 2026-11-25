/**
 * Where each box of the Topology view goes (#3110). Pure, so tests can check it.
 * One spine, read top to bottom: source of truth → hub (+ Ossie exit to the right) → machines.
 * Each row has a caption at the left margin, above the row; lines carry no labels.
 */

export const TOPO_W = 1000;
export interface Box { x: number; y: number; w: number; h: number }

export const CAPTION_X = 20;
export const CAPTIONS = { truth: 30, hub: 172, nodes: 322 } as const;

export const VAULT: Box = { x: 340, y: 44, w: 320, h: 84 };
export const HUB: Box = { x: 340, y: 186, w: 320, h: 100 };
export const OSSIE: Box = { x: 740, y: 198, w: 240, h: 76 };

const NODE_H = 104;
const ROW_GAP = 24;
const TOP = 362;
const MARGIN = 20;
const GAP = 16;
export const PER_ROW = 4;
export const TRUNK_Y = 340;

/** n node boxes plus one strangers box, PER_ROW to a row, centred. */
export function nodeBoxes(n: number): { nodes: Box[]; strangers: Box; height: number } {
  const total = n + 1;
  const w = Math.floor((TOPO_W - 2 * MARGIN - (PER_ROW - 1) * GAP) / PER_ROW);
  const boxes: Box[] = [];
  for (let i = 0; i < total; i++) {
    const row = Math.floor(i / PER_ROW);
    const inRow = Math.min(PER_ROW, total - row * PER_ROW);
    const rowW = inRow * w + (inRow - 1) * GAP;
    const col = i % PER_ROW;
    boxes.push({ x: Math.round((TOPO_W - rowW) / 2 + col * (w + GAP)), y: TOP + row * (NODE_H + ROW_GAP), w, h: NODE_H });
  }
  const rows = Math.ceil(total / PER_ROW);
  return { nodes: boxes.slice(0, n), strangers: boxes[n], height: TOP + rows * (NODE_H + ROW_GAP) };
}

/** Cut text so it fits a box: average sans glyph ≈ 0.56 em. */
export function fit(text: string, width: number, size: number): string {
  const max = Math.max(4, Math.floor(width / (size * 0.56)));
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export const bottom = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h });
export const top = (b: Box) => ({ x: b.x + b.w / 2, y: b.y });
