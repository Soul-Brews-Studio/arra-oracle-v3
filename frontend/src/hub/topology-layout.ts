/**
 * Where each box of the Topology view goes (#3110). Pure, so tests can check it.
 * Rows: truth (vault + private ψ) · hub + Ossie · nodes and the strangers box, wrapping.
 */

export const TOPO_W = 1000;
export interface Box { x: number; y: number; w: number; h: number }

export const VAULT: Box = { x: 230, y: 16, w: 300, h: 92 };
export const PRIVATE: Box = { x: 600, y: 16, w: 360, h: 92 };
export const HUB: Box = { x: 330, y: 170, w: 340, h: 108 };
export const OSSIE: Box = { x: 760, y: 170, w: 220, h: 108 };

const NODE_H = 132;
const ROW_GAP = 28;
const TOP = 360;
const MARGIN = 20;
const GAP = 16;
export const PER_ROW = 5;

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

export const bottom = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h });
export const top = (b: Box) => ({ x: b.x + b.w / 2, y: b.y });
export const TRUNK_Y = 320;
