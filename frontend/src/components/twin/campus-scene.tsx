"use client";

import { ContactShadows, Html, OrbitControls, RoundedBox } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import * as React from "react";
import * as THREE from "three";

import type { Building, BuildingStatus } from "@/lib/types";

/**
 * Stylised campus digital twin.
 *
 * Deliberately not an architectural model. The job here is to make one
 * question answerable in a glance -- "which building is wasting resources
 * right now, and how badly?" -- so form is kept abstract and every visual
 * channel carries state:
 *
 *   facade tint      building status
 *   lit floor bands  live occupancy
 *   ground ring      severity
 *   rising beam      an open anomaly, pulsing at a rate set by severity
 */

// Positions spread wider than footprints shrink, so neighbouring blocks read
// as separate volumes from an orbiting camera rather than merging into a mass.
const POS_SCALE = 0.95;
const SIZE_SCALE = 0.52;
const HEIGHT_SCALE = 0.92;

const STATUS_COLOURS: Record<BuildingStatus, { base: string; accent: string; glow: string }> = {
  NORMAL: { base: "#1e2f2b", accent: "#5ff0b6", glow: "#34e5a0" },
  WARNING: { base: "#33291a", accent: "#ffcb66", glow: "#f5b94a" },
  CRITICAL: { base: "#372022", accent: "#ff8f8f", glow: "#ff6b6b" },
};

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

/** Layout used when the API is unreachable, so the twin still renders. */
export const FALLBACK_CAMPUS: TwinBuilding[] = [
  { id: 1, code: "ADMIN", name: "Administration Block", status: "NORMAL", occupancy_pct_now: 42, floors: 4, twin_x: -17, twin_z: 13, twin_w: 14, twin_d: 10, twin_h: 13, twin_rotation: 0.06, open_anomalies: 0 },
  { id: 2, code: "ENGG", name: "Engineering Block", status: "NORMAL", occupancy_pct_now: 58, floors: 5, twin_x: 15, twin_z: 9, twin_w: 16, twin_d: 12, twin_h: 16, twin_rotation: -0.05, open_anomalies: 0 },
  { id: 3, code: "CSE", name: "Computer Science Block", status: "NORMAL", occupancy_pct_now: 51, floors: 4, twin_x: 13, twin_z: -15, twin_w: 14, twin_d: 11, twin_h: 13, twin_rotation: 0.04, open_anomalies: 0 },
  { id: 4, code: "LIB", name: "Central Library", status: "NORMAL", occupancy_pct_now: 64, floors: 3, twin_x: -4, twin_z: -7, twin_w: 13, twin_d: 13, twin_h: 11, twin_rotation: 0, open_anomalies: 0 },
  { id: 5, code: "SC", name: "Student Center", status: "NORMAL", occupancy_pct_now: 47, floors: 2, twin_x: -19, twin_z: -15, twin_w: 12, twin_d: 10, twin_h: 8, twin_rotation: -0.08, open_anomalies: 0 },
];

// --------------------------------------------------------------------------
// Building
// --------------------------------------------------------------------------
function BuildingMesh({
  building,
  selected,
  hovered,
  onSelect,
  onHover,
  interactive,
  showLabel,
}: {
  building: TwinBuilding;
  selected: boolean;
  hovered: boolean;
  onSelect?: (id: number) => void;
  onHover?: (id: number | null) => void;
  interactive: boolean;
  showLabel: boolean;
}) {
  const colours = STATUS_COLOURS[building.status];
  const group = React.useRef<THREE.Group>(null);
  const beam = React.useRef<THREE.Mesh>(null);
  const ring = React.useRef<THREE.Mesh>(null);

  const alert = building.status !== "NORMAL";
  // Critical issues pulse faster: urgency is legible before you read a label.
  const pulseRate = building.status === "CRITICAL" ? 2.6 : 1.5;

  const { width, depth, height } = React.useMemo(
    () => ({
      width: building.twin_w * SIZE_SCALE,
      depth: building.twin_d * SIZE_SCALE,
      height: building.twin_h * HEIGHT_SCALE,
    }),
    [building.twin_w, building.twin_d, building.twin_h],
  );

  // Lit floor bands, count matching the building's real floor count.
  const bands = React.useMemo(() => {
    const count = Math.max(2, Math.min(building.floors, 6));
    const spacing = height / (count + 0.6);
    return Array.from({ length: count }, (_, i) => spacing * (i + 0.9));
  }, [building.floors, height]);

  const litFraction = Math.max(0.12, Math.min(1, building.occupancy_pct_now / 70));

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (beam.current && alert) {
      const material = beam.current.material as THREE.MeshBasicMaterial;
      material.opacity = 0.05 + 0.09 * (0.5 + 0.5 * Math.sin(t * pulseRate));
    }
    if (ring.current && alert) {
      const pulse = 1 + 0.07 * Math.sin(t * pulseRate);
      ring.current.scale.set(pulse, pulse, 1);
    }
    if (group.current) {
      const target = selected ? 0.55 : hovered ? 0.3 : 0;
      group.current.position.y += (target - group.current.position.y) * 0.12;
    }
  });

  return (
    <group
      position={[building.twin_x * POS_SCALE, 0, building.twin_z * POS_SCALE]}
      rotation={[0, building.twin_rotation, 0]}
    >
      <group ref={group}>
        {/* main volume */}
        <RoundedBox
          args={[width, height, depth]}
          radius={0.18}
          smoothness={3}
          position={[0, height / 2, 0]}
          onClick={
            interactive
              ? (event) => {
                  event.stopPropagation();
                  onSelect?.(building.id);
                }
              : undefined
          }
          onPointerOver={
            interactive
              ? (event) => {
                  event.stopPropagation();
                  onHover?.(building.id);
                  document.body.style.cursor = "pointer";
                }
              : undefined
          }
          onPointerOut={
            interactive
              ? () => {
                  onHover?.(null);
                  document.body.style.cursor = "auto";
                }
              : undefined
          }
        >
          <meshStandardMaterial
            color={colours.base}
            roughness={0.48}
            metalness={0.16}
            emissive={colours.accent}
            emissiveIntensity={selected ? 0.26 : hovered ? 0.17 : 0.07}
          />
        </RoundedBox>

        {/* lit floor bands - brightness tracks live occupancy */}
        {bands.map((y, index) => (
          <mesh key={index} position={[0, y, 0]}>
            <boxGeometry args={[width * 1.012, 0.1, depth * 1.012]} />
            <meshBasicMaterial
              color={colours.accent}
              transparent
              opacity={
                Math.min(0.92, litFraction * (0.55 + 0.12 * Math.sin(index * 1.7)) * (selected ? 1.5 : 1))
              }
              depthWrite={false}
            />
          </mesh>
        ))}

        {/* roof cap */}
        <mesh position={[0, height + 0.1, 0]}>
          <boxGeometry args={[width * 0.84, 0.2, depth * 0.84]} />
          <meshStandardMaterial
            color={colours.base}
            roughness={0.5}
            metalness={0.4}
            emissive={colours.accent}
            emissiveIntensity={0.1}
          />
        </mesh>

        {/* alert beam */}
        {alert ? (
          <mesh ref={beam} position={[0, height + 3.6, 0]}>
            <cylinderGeometry args={[0.05, 0.55, 7.2, 12, 1, true]} />
            <meshBasicMaterial
              color={colours.glow}
              transparent
              opacity={0.1}
              side={THREE.DoubleSide}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        ) : null}
      </group>

      {/* ground ring */}
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry
          args={[Math.max(width, depth) * 0.72, Math.max(width, depth) * 0.79, 56]}
        />
        <meshBasicMaterial
          color={colours.glow}
          transparent
          opacity={selected ? 0.75 : alert ? 0.42 : 0.14}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* selection footprint */}
      {selected ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <planeGeometry args={[width * 1.7, depth * 1.7]} />
          <meshBasicMaterial
            color={colours.glow}
            transparent
            opacity={0.07}
            depthWrite={false}
          />
        </mesh>
      ) : null}

      {showLabel ? (
        /*
         * DOM labels rather than 3D text. Mesh text is occluded by whatever
         * block happens to stand in front of it, and the depth-test escape
         * hatch does not reliably reach troika's lazily-created material.
         * A DOM overlay is always legible, stays crisp at any zoom, and can
         * use the same type scale as the rest of the product.
         */
        <Html
          position={[0, height + 1.4, 0]}
          center
          distanceFactor={34}
          zIndexRange={[20, 0]}
          style={{ pointerEvents: "none", userSelect: "none" }}
        >
          <div
            style={{
              fontFamily: "var(--font-mono), monospace",
              fontSize: "11px",
              fontWeight: 600,
              letterSpacing: "0.08em",
              padding: "3px 8px",
              borderRadius: "6px",
              whiteSpace: "nowrap",
              color: selected || hovered || alert ? colours.accent : "#8aa8a1",
              background: "rgba(5, 11, 10, 0.72)",
              border: `1px solid ${
                selected || alert ? `${colours.glow}55` : "rgba(255,255,255,0.09)"
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

// --------------------------------------------------------------------------
// Ground
// --------------------------------------------------------------------------
function Ground() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[160, 160]} />
        <meshStandardMaterial color="#080f0e" roughness={0.95} metalness={0.05} />
      </mesh>
      <gridHelper args={[150, 50, "#1b2d29", "#122220"]} position={[0, 0.01, 0]} />
      {/* campus walkway */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
        <planeGeometry args={[6, 96]} />
        <meshBasicMaterial color="#12211e" transparent opacity={0.6} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 2]} position={[0, 0.015, 0]}>
        <planeGeometry args={[6, 96]} />
        <meshBasicMaterial color="#12211e" transparent opacity={0.6} />
      </mesh>
    </group>
  );
}

function Rig({ autoRotate }: { autoRotate: boolean }) {
  useFrame((state) => {
    if (!autoRotate) return;
    const t = state.clock.elapsedTime * 0.075;
    state.camera.position.x = Math.sin(t) * 58;
    state.camera.position.z = Math.cos(t) * 58;
    state.camera.position.y = 42;
    state.camera.lookAt(0, 5, 0);
  });
  return null;
}

// --------------------------------------------------------------------------
// Scene
// --------------------------------------------------------------------------
export function CampusScene({
  buildings,
  selectedId,
  onSelect,
  interactive = true,
  autoRotate = false,
  showLabels = true,
  className,
}: {
  buildings: TwinBuilding[];
  selectedId?: number | null;
  onSelect?: (id: number | null) => void;
  interactive?: boolean;
  autoRotate?: boolean;
  showLabels?: boolean;
  className?: string;
}) {
  const [hovered, setHovered] = React.useState<number | null>(null);
  const [contextLost, setContextLost] = React.useState(false);
  const [generation, setGeneration] = React.useState(0);

  React.useEffect(
    () => () => {
      document.body.style.cursor = "auto";
    },
    [],
  );

  // A WebGL context can be dropped by the driver, by tab suspension, or by
  // running out of GPU memory. Rather than leaving a blank canvas, fall back
  // to a readable list and offer to rebuild the scene.
  if (contextLost) {
    return (
      <div className={className}>
        <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="max-w-sm space-y-1.5">
            <p className="text-sm font-medium text-ink">3D view unavailable</p>
            <p className="text-xs leading-relaxed text-ink-muted">
              The browser dropped the WebGL context. Building status is listed
              below, and the twin can be rebuilt.
            </p>
          </div>
          <ul className="w-full max-w-sm space-y-1.5">
            {buildings.map((building) => (
              <li
                key={building.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-[rgb(var(--line)/0.1)] bg-surface/50 px-3 py-2"
              >
                <button
                  onClick={() => onSelect?.(building.id)}
                  className="flex items-center gap-2 text-[12px] text-ink-soft hover:text-ink"
                >
                  <span
                    className="size-1.5 rounded-full"
                    style={{ background: STATUS_COLOURS[building.status].glow }}
                  />
                  {building.name}
                </button>
                <span className="font-mono text-[10px] text-ink-muted">
                  {building.status}
                </span>
              </li>
            ))}
          </ul>
          <button
            onClick={() => {
              setContextLost(false);
              setGeneration((g) => g + 1);
            }}
            className="rounded-lg border border-mint/35 px-3 py-1.5 text-xs font-medium text-mint transition-colors hover:bg-mint/10"
          >
            Rebuild the twin
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <Canvas
        key={generation}
        dpr={[1, 1.75]}
        camera={{ position: [46, 44, 52], fov: 33 }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener(
            "webglcontextlost",
            (event) => {
              event.preventDefault();
              setContextLost(true);
            },
            { once: true },
          );
        }}
        onPointerMissed={() => interactive && onSelect?.(null)}
      >
        <color attach="background" args={["#050b0a"]} />
        <fog attach="fog" args={["#050b0a", 105, 215]} />

        <ambientLight intensity={0.75} />
        {/* key */}
        <directionalLight position={[30, 42, 24]} intensity={2.1} color="#eafaf3" />
        {/* cool fill from the opposite side, so shadowed faces still read */}
        <directionalLight position={[-28, 20, -26]} intensity={0.85} color="#5ad2f0" />
        {/* rim, to separate the blocks from the ground plane */}
        <directionalLight position={[-10, 8, 34]} intensity={0.55} color="#34e5a0" />
        <hemisphereLight args={["#9fe8cf", "#0a1412", 0.5]} />

        <Ground />

        {buildings.map((building) => (
          <BuildingMesh
            key={building.id}
            building={building}
            selected={selectedId === building.id}
            hovered={hovered === building.id}
            onSelect={(id) => onSelect?.(id)}
            onHover={setHovered}
            interactive={interactive}
            showLabel={showLabels}
          />
        ))}

        <ContactShadows
          position={[0, 0.04, 0]}
          opacity={0.5}
          scale={110}
          blur={2.4}
          far={26}
          color="#000000"
        />

        <Rig autoRotate={autoRotate} />
        {interactive ? (
          <OrbitControls
            enablePan={false}
            minDistance={32}
            maxDistance={130}
            minPolarAngle={0.18}
            maxPolarAngle={Math.PI / 2.35}
            enableDamping
            dampingFactor={0.06}
            target={[0, 5, 0]}
            autoRotate={autoRotate}
            autoRotateSpeed={0.42}
          />
        ) : null}
      </Canvas>
    </div>
  );
}
