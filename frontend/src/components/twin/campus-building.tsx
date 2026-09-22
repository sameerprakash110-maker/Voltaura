"use client";

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as React from "react";
import * as THREE from "three";

import {
  ARCHETYPES,
  ARCHETYPE_BY_CODE,
  STATUS_COLOUR,
  type Archetype,
  type TwinBuilding,
} from "./campus-data";

/**
 * One campus block, assembled from architectural parts rather than extruded as
 * a single box.
 *
 * The composition follows what the reference material actually shows: a
 * cream-plaster shell, continuous horizontal ribbon glazing at each floor,
 * darker structural fins breaking up the long elevations, a full-height glazed
 * stair core, a parapet upstand, an entrance canopy, and the overhead water
 * tanks that sit on essentially every rooftop on an Indian campus.
 *
 * Resource status is deliberately NOT painted onto the building. Recolouring a
 * whole block neon red destroys the architecture and tells you less than a
 * ground ring does. Status shows as a ring at the base plus a small roof
 * marker, so the model stays readable as a building.
 */

const FLOOR_H = 3.6;

// Shared materials: one instance each, reused across all seven blocks so the
// renderer is not swapping material state hundreds of times per frame.
function useSharedMaterials(archetype: Archetype) {
  return React.useMemo(() => {
    const wall = new THREE.MeshStandardMaterial({
      color: archetype.wall,
      roughness: 0.82,
      metalness: 0.02,
    });
    const structure = new THREE.MeshStandardMaterial({
      color: archetype.structure,
      roughness: 0.68,
      metalness: 0.12,
    });
    const glass = new THREE.MeshStandardMaterial({
      color: "#5f8ba6",
      roughness: 0.14,
      metalness: 0.68,
      envMapIntensity: 1.1,
    });
    const glassDeep = new THREE.MeshStandardMaterial({
      color: "#3d6076",
      roughness: 0.1,
      metalness: 0.75,
    });
    const slab = new THREE.MeshStandardMaterial({
      color: "#d8d3c6",
      roughness: 0.9,
      metalness: 0.0,
    });
    const plant = new THREE.MeshStandardMaterial({
      color: "#9a9a94",
      roughness: 0.75,
      metalness: 0.25,
    });
    const tank = new THREE.MeshStandardMaterial({
      color: "#2f4f63",
      roughness: 0.55,
      metalness: 0.15,
    });
    return { wall, structure, glass, glassDeep, slab, plant, tank };
  }, [archetype]);
}

export function CampusBuilding({
  building,
  selected,
  hovered,
  dimmed,
  interactive,
  showLabel,
  onSelect,
  onHover,
}: {
  building: TwinBuilding;
  selected: boolean;
  hovered: boolean;
  dimmed: boolean;
  interactive: boolean;
  showLabel: boolean;
  onSelect?: (id: number) => void;
  onHover?: (id: number | null) => void;
}) {
  const archetype =
    ARCHETYPES[ARCHETYPE_BY_CODE[building.code] ?? "teaching"] ?? ARCHETYPES.teaching;
  const mats = useSharedMaterials(archetype);

  const w = building.twin_w;
  const d = building.twin_d;
  const h = building.twin_h;
  const floors = Math.max(2, building.floors);
  const floorH = (h - archetype.parapet) / floors;

  const statusColour = STATUS_COLOUR[building.status];
  const alert = building.status !== "NORMAL";
  const pulseRate = building.status === "CRITICAL" ? 2.4 : 1.4;

  const ringRef = React.useRef<THREE.Mesh>(null);
  const markerRef = React.useRef<THREE.Mesh>(null);
  const groupRef = React.useRef<THREE.Group>(null);

  // Lit windows track live occupancy: an empty block reads dark.
  const lit = Math.max(0.1, Math.min(1, building.occupancy_pct_now / 65));

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (ringRef.current && alert) {
      const m = ringRef.current.material as THREE.MeshBasicMaterial;
      m.opacity = 0.3 + 0.28 * (0.5 + 0.5 * Math.sin(t * pulseRate));
    }
    if (markerRef.current && alert) {
      markerRef.current.position.y =
        h + 2.6 + Math.sin(t * pulseRate) * 0.45;
    }
    if (groupRef.current) {
      // Lift very slightly on selection: enough to read, not enough to float.
      const target = selected ? 0.9 : hovered ? 0.45 : 0;
      groupRef.current.position.y +=
        (target - groupRef.current.position.y) * 0.14;
    }
  });

  // ---- floor bands -----------------------------------------------------
  // The facade mode is what actually differentiates the blocks. A curtain-
  // walled block is mostly glass with a thin spandrel; a banded block reads as
  // solid plaster with ribbon windows punched through it; a mixed block
  // alternates deep and shallow glazing, which is what gives the studio and
  // amenity blocks their heavier rhythm.
  const bands = React.useMemo(
    () =>
      Array.from({ length: floors }, (_, i) => {
        let ratio: number;
        if (archetype.facade === "curtain") {
          ratio = 0.86;
        } else if (archetype.facade === "mixed") {
          ratio = i % 2 === 0 ? archetype.glazing * 1.05 : archetype.glazing * 0.55;
        } else {
          ratio = archetype.glazing * 0.74;
        }
        return {
          y: i * floorH + floorH * (archetype.facade === "curtain" ? 0.5 : 0.62),
          height: Math.min(floorH * 0.92, floorH * ratio),
        };
      }),
    [floors, floorH, archetype.glazing, archetype.facade],
  );

  // A curtain-walled block should read as glass from a distance, so its
  // plaster shell is pulled in behind the glazing line rather than sitting
  // flush with it.
  const shellInset = archetype.facade === "curtain" ? 0.9 : 0;

  // ---- vertical fins along the two long elevations ---------------------
  const longAxisIsX = w >= d;
  const finPositions = React.useMemo(() => {
    if (!archetype.fins) return [];
    const span = longAxisIsX ? w : d;
    const step = span / (archetype.fins + 1);
    return Array.from({ length: archetype.fins }, (_, i) => -span / 2 + step * (i + 1));
  }, [archetype.fins, longAxisIsX, w, d]);

  const bodyH = h - archetype.parapet;

  // ---- entrance placement ----------------------------------------------
  const entrance = React.useMemo(() => {
    const cw = Math.min(archetype.canopyWidth, (longAxisIsX ? w : d) * 0.45);
    switch (archetype.entrance) {
      case "north":
        return { pos: [0, 0, -d / 2] as const, rot: 0, cw };
      case "south":
        return { pos: [0, 0, d / 2] as const, rot: 0, cw };
      case "east":
        return { pos: [w / 2, 0, 0] as const, rot: Math.PI / 2, cw };
      default:
        return { pos: [-w / 2, 0, 0] as const, rot: Math.PI / 2, cw };
    }
  }, [archetype.entrance, archetype.canopyWidth, w, d, longAxisIsX]);

  const handlers = interactive
    ? {
        onClick: (e: { stopPropagation: () => void }) => {
          e.stopPropagation();
          onSelect?.(building.id);
        },
        onPointerOver: (e: { stopPropagation: () => void }) => {
          e.stopPropagation();
          onHover?.(building.id);
          document.body.style.cursor = "pointer";
        },
        onPointerOut: () => {
          onHover?.(null);
          document.body.style.cursor = "auto";
        },
      }
    : {};

  const opacity = dimmed ? 0.42 : 1;

  return (
    <group
      position={[building.twin_x, 0, building.twin_z]}
      rotation={[0, building.twin_rotation, 0]}
    >
      <group ref={groupRef}>
        {/* ---- main shell ---- */}
        <mesh position={[0, bodyH / 2, 0]} castShadow receiveShadow {...handlers}>
          <boxGeometry args={[w - shellInset, bodyH, d - shellInset]} />
          <primitive
            object={mats.wall}
            attach="material"
            transparent={dimmed}
            opacity={opacity}
          />
        </mesh>

        {/* ---- ribbon glazing, one band per floor ---- */}
        {bands.map((band, i) => (
          <group key={`band-${i}`}>
            <mesh position={[0, band.y, 0]}>
              <boxGeometry args={[w + 0.14, band.height, d + 0.14]} />
              <meshStandardMaterial
                color={archetype.facade === "curtain" ? "#46708c" : "#5f8ba6"}
                roughness={archetype.facade === "curtain" ? 0.08 : 0.16}
                metalness={archetype.facade === "curtain" ? 0.82 : 0.66}
                emissive="#9fd0e8"
                emissiveIntensity={lit * (archetype.facade === "curtain" ? 0.4 : 0.28)}
                transparent={dimmed}
                opacity={opacity}
              />
            </mesh>
            {/* slab edge below each band, catching light like real concrete */}
            <mesh position={[0, band.y - band.height / 2 - 0.22, 0]}>
              <boxGeometry args={[w + 0.3, 0.3, d + 0.3]} />
              <primitive
                object={mats.slab}
                attach="material"
                transparent={dimmed}
                opacity={opacity}
              />
            </mesh>
          </group>
        ))}

        {/* ---- vertical structural fins ---- */}
        {finPositions.map((p, i) =>
          longAxisIsX ? (
            <React.Fragment key={`fin-${i}`}>
              <mesh position={[p, bodyH / 2, d / 2 + archetype.finDepth / 2]}>
                <boxGeometry args={[0.9, bodyH, archetype.finDepth]} />
                <primitive object={mats.structure} attach="material" />
              </mesh>
              <mesh position={[p, bodyH / 2, -d / 2 - archetype.finDepth / 2]}>
                <boxGeometry args={[0.9, bodyH, archetype.finDepth]} />
                <primitive object={mats.structure} attach="material" />
              </mesh>
            </React.Fragment>
          ) : (
            <React.Fragment key={`fin-${i}`}>
              <mesh position={[w / 2 + archetype.finDepth / 2, bodyH / 2, p]}>
                <boxGeometry args={[archetype.finDepth, bodyH, 0.9]} />
                <primitive object={mats.structure} attach="material" />
              </mesh>
              <mesh position={[-w / 2 - archetype.finDepth / 2, bodyH / 2, p]}>
                <boxGeometry args={[archetype.finDepth, bodyH, 0.9]} />
                <primitive object={mats.structure} attach="material" />
              </mesh>
            </React.Fragment>
          ),
        )}

        {/* ---- full-height glazed stair / lift core ---- */}
        {archetype.core !== null ? (
          <mesh
            position={
              longAxisIsX
                ? [(-0.5 + archetype.core) * w, bodyH / 2, d / 2 + 0.5]
                : [w / 2 + 0.5, bodyH / 2, (-0.5 + archetype.core) * d]
            }
          >
            <boxGeometry
              args={
                longAxisIsX
                  ? [Math.min(9, w * 0.16), bodyH + 1.2, 1.4]
                  : [1.4, bodyH + 1.2, Math.min(9, d * 0.16)]
              }
            />
            <meshStandardMaterial
              color="#3d6076"
              roughness={0.1}
              metalness={0.75}
              emissive="#8fc4e0"
              emissiveIntensity={lit * 0.22}
            />
          </mesh>
        ) : null}

        {/* ---- parapet ---- */}
        <mesh position={[0, bodyH + archetype.parapet / 2, 0]}>
          <boxGeometry args={[w + 0.5, archetype.parapet, d + 0.5]} />
          <primitive object={mats.wall} attach="material" />
        </mesh>
        <mesh position={[0, bodyH + archetype.parapet + 0.08, 0]}>
          <boxGeometry args={[w + 0.8, 0.16, d + 0.8]} />
          <primitive object={mats.structure} attach="material" />
        </mesh>

        {/* ---- entrance canopy ---- */}
        <group position={[entrance.pos[0], 0, entrance.pos[2]]} rotation={[0, entrance.rot, 0]}>
          <mesh position={[0, 4.3, 0]}>
            <boxGeometry args={[entrance.cw, 0.45, 6.5]} />
            <primitive object={mats.slab} attach="material" />
          </mesh>
          <mesh position={[-entrance.cw / 2 + 0.9, 2.1, 2.4]}>
            <boxGeometry args={[0.7, 4.3, 0.7]} />
            <primitive object={mats.structure} attach="material" />
          </mesh>
          <mesh position={[entrance.cw / 2 - 0.9, 2.1, 2.4]}>
            <boxGeometry args={[0.7, 4.3, 0.7]} />
            <primitive object={mats.structure} attach="material" />
          </mesh>
          {/* glazed entrance screen */}
          <mesh position={[0, 2.0, 0.2]}>
            <boxGeometry args={[entrance.cw * 0.7, 4.0, 0.3]} />
            <meshStandardMaterial
              color="#4a7590"
              roughness={0.12}
              metalness={0.7}
              emissive="#8fc4e0"
              emissiveIntensity={0.16}
            />
          </mesh>
          {/* steps */}
          <mesh position={[0, 0.12, 3.6]}>
            <boxGeometry args={[entrance.cw * 0.8, 0.25, 2.4]} />
            <primitive object={mats.slab} attach="material" />
          </mesh>
        </group>

        {/* ---- rooftop: overhead water tanks + plant ---- */}
        {Array.from({ length: archetype.roofTanks }, (_, i) => {
          const spread = (longAxisIsX ? w : d) * 0.5;
          const off = archetype.roofTanks === 1 ? 0 : -spread / 2 + (i * spread) / Math.max(1, archetype.roofTanks - 1);
          return (
            <group
              key={`tank-${i}`}
              position={
                longAxisIsX
                  ? [off, bodyH + archetype.parapet, -d * 0.18]
                  : [w * 0.18, bodyH + archetype.parapet, off]
              }
            >
              {/* support frame */}
              <mesh position={[0, 1.1, 0]}>
                <boxGeometry args={[2.4, 2.2, 2.4]} />
                <primitive object={mats.structure} attach="material" />
              </mesh>
              <mesh position={[0, 3.0, 0]}>
                <cylinderGeometry args={[1.5, 1.5, 1.9, 12]} />
                <primitive object={mats.tank} attach="material" />
              </mesh>
            </group>
          );
        })}

        {Array.from({ length: archetype.roofPlant }, (_, i) => {
          const spread = (longAxisIsX ? w : d) * 0.44;
          const off = archetype.roofPlant === 1 ? 0 : -spread / 2 + (i * spread) / Math.max(1, archetype.roofPlant - 1);
          return (
            <mesh
              key={`plant-${i}`}
              position={
                longAxisIsX
                  ? [off, bodyH + archetype.parapet + 0.9, d * 0.2]
                  : [-w * 0.2, bodyH + archetype.parapet + 0.9, off]
              }
            >
              <boxGeometry args={[4.2, 1.8, 3.0]} />
              <primitive object={mats.plant} attach="material" />
            </mesh>
          );
        })}

        {/* ---- status roof marker (subtle, not a repaint) ---- */}
        {alert ? (
          <mesh ref={markerRef} position={[0, h + 2.6, 0]}>
            <octahedronGeometry args={[1.5, 0]} />
            <meshBasicMaterial color={statusColour} transparent opacity={0.85} />
          </mesh>
        ) : null}
      </group>

      {/* ---- ground status ring ---- */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.16, 0]}>
        <ringGeometry
          args={[Math.max(w, d) * 0.58, Math.max(w, d) * 0.58 + 1.6, 64]}
        />
        <meshBasicMaterial
          color={selected ? "#ffffff" : statusColour}
          transparent
          opacity={selected ? 0.9 : alert ? 0.45 : 0.14}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* ---- selection footprint ---- */}
      {selected ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1, 0]}>
          <planeGeometry args={[w + 12, d + 12]} />
          <meshBasicMaterial
            color={statusColour}
            transparent
            opacity={0.1}
            depthWrite={false}
          />
        </mesh>
      ) : null}

      {/* ---- label ---- */}
      {showLabel ? (
        <Html
          position={[0, h + (alert ? 6.5 : 4.2), 0]}
          center
          distanceFactor={120}
          zIndexRange={[20, 0]}
          style={{ pointerEvents: "none", userSelect: "none" }}
        >
          <div
            style={{
              fontFamily: "var(--font-mono), monospace",
              fontSize: "12px",
              fontWeight: 600,
              letterSpacing: "0.08em",
              padding: "4px 9px",
              borderRadius: "6px",
              whiteSpace: "nowrap",
              color: selected || hovered || alert ? statusColour : "#c3d3ce",
              background: "rgba(5, 11, 10, 0.82)",
              border: `1px solid ${
                selected || alert ? `${statusColour}66` : "rgba(255,255,255,0.12)"
              }`,
              backdropFilter: "blur(4px)",
            }}
          >
            {building.code}
          </div>
        </Html>
      ) : null}
    </group>
  );
}
