import * as THREE from 'three';

export interface GraphNode {
  id: string;
  type: string;
  label: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  concepts?: string[];
  cluster?: number;
  position?: THREE.Vector3;
  source_file?: string;
  project?: string;  // ghq-style path for cross-repo access
}

export interface GraphLink {
  source: string;
  target: string;
}

export const TYPE_COLORS_HEX: Record<string, string> = {
  principle: '#60a5fa',  // blue
  learning: '#fbbf24',   // yellow
  retro: '#4ade80',      // green
};

export const TYPE_COLORS_NUM: Record<string, number> = {
  principle: 0x60a5fa,   // blue
  learning: 0xfbbf24,    // yellow
  retro: 0x4ade80,       // green
};

/** Graph3D page uses different colors */
export const TYPE_COLORS_3D: Record<string, number> = {
  principle: 0xa78bfa,  // Purple
  learning: 0x4ade80,   // Green
  retro: 0x38bdf8,      // Cyan/sky blue
};

export const STORAGE_KEY_VIEW = 'oracle-graph-view-mode';
export const STORAGE_KEY_FULL = 'oracle-graph-show-full';
export const STORAGE_KEY_HUD = 'oracle-graph-show-hud';
export const DEFAULT_NODE_LIMIT = 200;

/** Lightning data structure for 3D graphs */
export interface LightningData {
  line: THREE.Line;
  nodeA: number;
  nodeB: number;
  phase: number;
  speed: number;
}

/** Graph API response with proper types */
export interface GraphNodeResponse {
  id: string;
  type: string;
  label: string;
  concepts?: string[];
  source_file?: string;
  project?: string;
}

export interface GraphApiResponse {
  nodes: GraphNodeResponse[];
  links: GraphLink[];
}
