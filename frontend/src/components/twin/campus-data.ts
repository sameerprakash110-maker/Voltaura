/**
 * Campus layout data for the RIT digital twin.
 *
 * Geometry and rendering are kept apart on purpose: everything in this file is
 * plain data, so the scene components stay declarative and the layout can be
 * tuned without touching any Three.js code.
 *
 * Units are metres, 1:1 with the `twin_*` columns the backend stores for each
 * building. Axis convention:
 *
 *      +X  east          -X  west
 *      +Z  south         -Z  north
 *
 * The quadrangle sits at the origin and is the anchor everything else is
 * positioned against.
 */

import type { Building, BuildingStatus } from "@/lib/types";

// --------------------------------------------------------------------------
// Site
// --------------------------------------------------------------------------
export const CAMPUS = {
  name: "Ramaiah Institute of Technology",
  short: "RIT Bengaluru",
  lat: 13.0307823,
  lon: 77.5649893,
} as const;

/** The central quadrangle: the visual anchor of the whole twin. */
export const QUAD = {
  width: 110,   // east-west
  depth: 80,    // north-south
  x: 0,
  z: 0,
} as const;

/** Outer extent of the modelled site, used for the ground plane and camera fit. */
export const SITE = {
  minX: -130,
  maxX: 140,
  minZ: -100,
  maxZ: 115,
} as const;

// --------------------------------------------------------------------------
// Architectural archetypes
// --------------------------------------------------------------------------
/**
 * Each block is built from the same parametric component, but the parameters
 * differ enough that no two blocks read alike -- which is the point. A single
 * "box with a different height" is exactly what this replaces.
 */
export interface Archetype {
  /** How the facade is composed. */
  facade: "banded" | "curtain" | "mixed";
  /** Vertical structural fins per long face. 0 disables them. */
  fins: number;
  finDepth: number;
  /** Fraction of each floor given over to glazing. */
  glazing: number;
  /** Parapet upstand above the top slab. */
  parapet: number;
  /** Which face carries the entrance canopy. */
  entrance: "north" | "south" | "east" | "west";
  canopyWidth: number;
  /** Overhead water tanks -- near-universal on Indian campus rooftops. */
  roofTanks: number;
  /** Plant/AHU boxes on the roof. */
  roofPlant: number;
  /** A full-height glazed stair/lift core, as a fraction along the long face. */
  core: number | null;
  /** Wall tint. Cream and off-white, per the reference material. */
  wall: string;
  /** Darker structural elements. */
  structure: string;
}

export const ARCHETYPES: Record<string, Archetype> = {
  // Older administrative block: solid, modest glazing, deep entrance porch.
  admin: {
    facade: "banded", fins: 6, finDepth: 0.7, glazing: 0.46, parapet: 1.1,
    entrance: "south", canopyWidth: 14, roofTanks: 2, roofPlant: 1, core: 0.22,
    wall: "#e8e2d4", structure: "#8d8b86",
  },
  // Architecture studios: big north light, generous glazing, expressed frame.
  studio: {
    facade: "mixed", fins: 9, finDepth: 0.9, glazing: 0.62, parapet: 1.3,
    entrance: "south", canopyWidth: 12, roofTanks: 2, roofPlant: 1, core: 0.74,
    wall: "#ece7dc", structure: "#7f8386",
  },
  // Long laboratory slab: strong vertical rhythm, banded ribbon windows.
  labSlab: {
    facade: "banded", fins: 12, finDepth: 0.8, glazing: 0.52, parapet: 1.2,
    entrance: "west", canopyWidth: 11, roofTanks: 3, roofPlant: 3, core: 0.3,
    wall: "#e4ddcd", structure: "#82858a",
  },
  // Newest block: curtain walling, lighter frame, larger glazed proportion.
  modern: {
    facade: "curtain", fins: 5, finDepth: 0.55, glazing: 0.74, parapet: 1.0,
    entrance: "north", canopyWidth: 16, roofTanks: 1, roofPlant: 2, core: 0.5,
    wall: "#eff0ec", structure: "#6f757c",
  },
  // Auditorium and canteen: tall ground floor, fewer openings up top.
  amenity: {
    facade: "mixed", fins: 7, finDepth: 0.75, glazing: 0.42, parapet: 1.5,
    entrance: "east", canopyWidth: 18, roofTanks: 3, roofPlant: 1, core: null,
    wall: "#e9e0cc", structure: "#8a8781",
  },
  // Departmental teaching: regular classroom bays, continuous corridor glazing.
  teaching: {
    facade: "banded", fins: 10, finDepth: 0.65, glazing: 0.5, parapet: 1.1,
    entrance: "north", canopyWidth: 12, roofTanks: 2, roofPlant: 1, core: 0.18,
    wall: "#e7e1d2", structure: "#87898c",
  },
  // Lecture theatres: low, wide, largely solid with a glazed foyer.
  lecture: {
    facade: "mixed", fins: 8, finDepth: 0.7, glazing: 0.38, parapet: 1.4,
    entrance: "north", canopyWidth: 15, roofTanks: 2, roofPlant: 1, core: 0.5,
    wall: "#eae4d6", structure: "#8b8a85",
  },
};

/** Which archetype each RIT block is built from. */
export const ARCHETYPE_BY_CODE: Record<string, keyof typeof ARCHETYPES> = {
  ADMIN: "admin",
  ARCH: "studio",
  ESB: "labSlab",
  APEX: "modern",
  MPB: "amenity",
  DES: "teaching",
  LHC: "lecture",
};

// --------------------------------------------------------------------------
// Twin building shape
// --------------------------------------------------------------------------
export interface TwinBuilding {
  id: number;
  code: string;
  name: string;
  status: BuildingStatus;
  occupancy_pct_now: number;
  floors: number;
  twin_x: number;
  twin_z: number;
  twin_w: number;
  twin_d: number;
  twin_h: number;
  twin_rotation: number;
  open_anomalies: number;
}

export function toTwinBuildings(buildings: Building[]): TwinBuilding[] {
  return buildings.map((b) => ({
    id: b.id,
    code: b.code,
    name: b.name,
    status: b.status,
    occupancy_pct_now: b.occupancy_pct_now,
    floors: b.floors,
    twin_x: b.twin_x,
    twin_z: b.twin_z,
    twin_w: b.twin_w,
    twin_d: b.twin_d,
    twin_h: b.twin_h,
    twin_rotation: b.twin_rotation,
    open_anomalies: b.open_anomalies,
  }));
}

/**
 * Layout used when the API is unreachable, so the twin still renders the real
 * campus rather than collapsing to an empty scene. Mirrors ml/campus.py.
 */
export const FALLBACK_CAMPUS: TwinBuilding[] = [
  { id: 1, code: "ADMIN", name: "Admin Block", status: "NORMAL", occupancy_pct_now: 44, floors: 4, twin_x: -28, twin_z: -58, twin_w: 60, twin_d: 18, twin_h: 15.2, twin_rotation: 0.025, open_anomalies: 0 },
  { id: 2, code: "ARCH", name: "Architecture Block", status: "NORMAL", occupancy_pct_now: 52, floors: 4, twin_x: 42, twin_z: -56, twin_w: 64, twin_d: 21, twin_h: 15.2, twin_rotation: -0.035, open_anomalies: 0 },
  { id: 3, code: "ESB", name: "ESB Block", status: "NORMAL", occupancy_pct_now: 61, floors: 5, twin_x: 80, twin_z: -6, twin_w: 22, twin_d: 78, twin_h: 19, twin_rotation: -0.02, open_anomalies: 0 },
  { id: 4, code: "APEX", name: "Apex Block", status: "NORMAL", occupancy_pct_now: 48, floors: 5, twin_x: 76, twin_z: 62, twin_w: 58, twin_d: 25, twin_h: 19, twin_rotation: 0.2, open_anomalies: 0 },
  { id: 5, code: "MPB", name: "Multipurpose Block", status: "NORMAL", occupancy_pct_now: 35, floors: 3, twin_x: -82, twin_z: -4, twin_w: 24, twin_d: 66, twin_h: 14, twin_rotation: 0.04, open_anomalies: 0 },
  { id: 6, code: "DES", name: "DES Block", status: "NORMAL", occupancy_pct_now: 57, floors: 4, twin_x: 6, twin_z: 64, twin_w: 70, twin_d: 22, twin_h: 15.2, twin_rotation: 0.04, open_anomalies: 0 },
  { id: 7, code: "LHC", name: "Lecture Hall Complex", status: "NORMAL", occupancy_pct_now: 63, floors: 3, twin_x: -66, twin_z: 66, twin_w: 62, twin_d: 27, twin_h: 12, twin_rotation: -0.05, open_anomalies: 0 },
];

// --------------------------------------------------------------------------
// Materials palette
// --------------------------------------------------------------------------
export const PALETTE = {
  grass: "#4e6247",
  grassDark: "#44573d",
  paving: "#9a9a92",
  pavingLight: "#adaca3",
  path: "#8e8d84",
  road: "#4a4a48",
  planter: "#4a5c3d",
  glass: "#6f97ad",
  glassDark: "#3f5f75",
  trunk: "#4a3b2c",
  foliageA: "#3c6b3a",
  foliageB: "#4a7c42",
  foliageC: "#2f5a33",
  kerb: "#b4b2a8",
} as const;

export const STATUS_COLOUR: Record<BuildingStatus, string> = {
  NORMAL: "#34e5a0",
  WARNING: "#f5b94a",
  CRITICAL: "#ff6b6b",
};

// --------------------------------------------------------------------------
// Deterministic scatter for vegetation
// --------------------------------------------------------------------------
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TreeInstance {
  x: number;
  z: number;
  scale: number;
  rotation: number;
  kind: 0 | 1 | 2;
}

/**
 * Tree positions are generated once from a fixed seed and rejected where they
 * would sit inside a building footprint or on the paved quadrangle, so the
 * planting reads as landscaping rather than confetti.
 */
export function generateTrees(
  buildings: TwinBuilding[],
  count = 150,
): TreeInstance[] {
  const rand = mulberry32(0x5eed);
  const out: TreeInstance[] = [];

  const blocked = buildings.map((b) => ({
    x: b.twin_x,
    z: b.twin_z,
    rx: Math.max(b.twin_w, b.twin_d) / 2 + 6,
  }));

  let guard = 0;
  while (out.length < count && guard < count * 40) {
    guard += 1;
    const x = SITE.minX + rand() * (SITE.maxX - SITE.minX);
    const z = SITE.minZ + rand() * (SITE.maxZ - SITE.minZ);

    // keep the quadrangle itself clear; plant only around its rim
    const insideQuad =
      Math.abs(x - QUAD.x) < QUAD.width / 2 + 3 &&
      Math.abs(z - QUAD.z) < QUAD.depth / 2 + 3;
    if (insideQuad) continue;

    if (blocked.some((b) => Math.hypot(x - b.x, z - b.z) < b.rx)) continue;

    out.push({
      x,
      z,
      scale: 0.7 + rand() * 0.75,
      rotation: rand() * Math.PI * 2,
      kind: Math.floor(rand() * 3) as 0 | 1 | 2,
    });
  }

  // A formal avenue of trees around the quadrangle edge.
  const rim = 8;
  const halfW = QUAD.width / 2 + 7;
  const halfD = QUAD.depth / 2 + 7;
  for (let i = 0; i < rim; i += 1) {
    const t = (i + 0.5) / rim;
    const px = -halfW + t * QUAD.width + 7;
    out.push({ x: px, z: -halfD, scale: 0.95, rotation: rand() * 6.28, kind: 1 });
    out.push({ x: px, z: halfD, scale: 0.95, rotation: rand() * 6.28, kind: 1 });
  }
  for (let i = 0; i < 6; i += 1) {
    const t = (i + 0.5) / 6;
    const pz = -halfD + t * QUAD.depth + 7;
    out.push({ x: -halfW, z: pz, scale: 0.9, rotation: rand() * 6.28, kind: 2 });
    out.push({ x: halfW, z: pz, scale: 0.9, rotation: rand() * 6.28, kind: 2 });
  }

  return out;
}

// --------------------------------------------------------------------------
// Pathways
// --------------------------------------------------------------------------
export interface PathSegment {
  x: number;
  z: number;
  w: number;
  d: number;
  rotation?: number;
}

/**
 * Pedestrian network: a perimeter walkway around the quadrangle plus spurs
 * reaching each block's entrance. Matches the "College Walkway" legible on the
 * satellite view.
 */
export const PATHS: PathSegment[] = [
  // perimeter walkway around the quadrangle
  { x: 0, z: -(QUAD.depth / 2 + 5), w: QUAD.width + 22, d: 6 },
  { x: 0, z: QUAD.depth / 2 + 5, w: QUAD.width + 22, d: 6 },
  { x: -(QUAD.width / 2 + 5), z: 0, w: 6, d: QUAD.depth + 16 },
  { x: QUAD.width / 2 + 5, z: 0, w: 6, d: QUAD.depth + 16 },

  // spurs to each block
  { x: -28, z: -49, w: 5, d: 14 },   // ADMIN
  { x: 42, z: -48, w: 5, d: 12 },    // ARCH
  { x: 68, z: -6, w: 18, d: 5 },     // ESB
  { x: 66, z: 48, w: 5, d: 22 },     // APEX
  { x: -69, z: -4, w: 18, d: 5 },    // MPB
  { x: 6, z: 52, w: 5, d: 16 },      // DES
  { x: -60, z: 51, w: 5, d: 20 },    // LHC

  // north campus road (9th Main side)
  { x: 0, z: -92, w: 250, d: 11 },
];

/** Landscaped strips that soften the edge between paving and buildings. */
export const PLANTERS: PathSegment[] = [
  { x: 0, z: -(QUAD.depth / 2 + 1.6), w: QUAD.width + 8, d: 2.6 },
  { x: 0, z: QUAD.depth / 2 + 1.6, w: QUAD.width + 8, d: 2.6 },
  { x: -(QUAD.width / 2 + 1.6), z: 0, w: 2.6, d: QUAD.depth + 4 },
  { x: QUAD.width / 2 + 1.6, z: 0, w: 2.6, d: QUAD.depth + 4 },
];

// --------------------------------------------------------------------------
// Camera presets
// --------------------------------------------------------------------------
export interface CameraPreset {
  key: string;
  label: string;
  position: [number, number, number];
  target: [number, number, number];
}

export const CAMERA_PRESETS: CameraPreset[] = [
  { key: "campus", label: "Campus", position: [222, 196, 258], target: [0, 0, 6] },
  { key: "quad", label: "Quadrangle", position: [96, 84, 148], target: [0, 4, 0] },
  { key: "north", label: "North", position: [6, 112, -250], target: [0, 6, -18] },
  { key: "east", label: "East", position: [288, 118, 12], target: [24, 6, 2] },
  { key: "south", label: "South", position: [14, 114, 272], target: [8, 6, 26] },
  { key: "west", label: "West", position: [-272, 116, -8], target: [-26, 6, 0] },
];

export const DEFAULT_PRESET = CAMERA_PRESETS[0];
