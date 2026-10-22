import type { Qualification } from "./types";

/**
 * The qualifications staff can grant. PLACEHOLDER names and levels until staff confirm the real ones
 * (open question B in CLAUDE.md). Later this list becomes data staff edit.
 */
export const QUALIFICATIONS: Qualification[] = [
  { code: "scull-1", name: "Sculling level 1 (placeholder)", track: "sculling", rank: 1 },
  { code: "scull-2", name: "Sculling level 2 (placeholder)", track: "sculling", rank: 2 },
  { code: "scull-3", name: "Sculling level 3 (placeholder)", track: "sculling", rank: 3 },
  { code: "sweep", name: "Sweep rowing (placeholder)", track: "sweep", rank: 1 },
];
