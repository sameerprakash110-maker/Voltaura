"use client";

import { ContactShadows, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as React from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import { CampusBuilding } from "./campus-building";
import { CAMERA_PRESETS, DEFAULT_PRESET } from "./campus-data";
import type { CameraPreset, TwinBuilding } from "./campus-data";
import {
  CampusGate,
  CampusGround,
  CampusLandmark,
  CampusPathways,
  CampusShrubs,
  CampusTrees,
  Quadrangle,
} from "./campus-environment";

export { FALLBACK_CAMPUS, toTwinBuildings, CAMERA_PRESETS } from "./campus-data";
export type { TwinBuilding, CameraPreset } from "./campus-data";

/**
 * VOLTAURA digital twin: Ramaiah Institute of Technology.
 *
 * A semi-realistic architectural model rather than a stylised abstraction. The
 * goal is that a student looks at it and recognises their own campus: the
 * quadrangle in the middle, Admin and Architecture to the north, ESB down the
 * east side, Apex on the south-east corner, the Multipurpose Block west, DES
 * and the Lecture Hall Complex to the south.
 *
 * Resource status rides on top of the architecture (ground rings, roof
 * markers) instead of replacing it, so the model stays legible as buildings.
 */

// --------------------------------------------------------------------------
// Lighting
// --------------------------------------------------------------------------
/**
 * Late-afternoon Bengaluru light: a warm key from the west, a cool sky fill so
 * shaded elevations still read, and a faint bounce off the paving. Shadows come
 * from one directional light whose ortho box covers the whole site.
 */
function CampusLighting() {
  return (
    <>
      <hemisphereLight args={["#cfe6f2", "#3c4a39", 0.85]} />
      <ambientLight intensity={0.48} />

      <directionalLight
        position={[130, 165, 95]}
        intensity={2.2}
        color="#fff3e2"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-200}
        shadow-camera-right={200}
        shadow-camera-top={200}
        shadow-camera-bottom={-200}
        shadow-camera-near={1}
        shadow-camera-far={560}
        shadow-bias={-0.0006}
      />
      <directionalLight position={[-140, 90, -120]} intensity={0.58} color="#bcd8ee" />
      <directionalLight position={[0, -40, 0]} intensity={0.16} color="#d8cfae" />
    </>
  );
}

// --------------------------------------------------------------------------
// Camera control
// --------------------------------------------------------------------------
/**
 * Eases the camera to a preset.
 *
 * Damped interpolation rather than a jump cut: moving between Campus and
 * Quadrangle keeps the viewer oriented, which matters when the whole point is
 * recognising a real place.
 */
function CameraRig({
  preset,
  controls,
  onSettled,
}: {
  preset: CameraPreset | null;
  controls: React.RefObject<OrbitControlsImpl | null>;
  onSettled: () => void;
}) {
  const { camera } = useThree();
  const target = React.useRef(new THREE.Vector3(0, 0, 4));
  const position = React.useRef(new THREE.Vector3());
  const active = React.useRef(false);

  React.useEffect(() => {
    if (!preset) return;
    position.current.set(...preset.position);
    target.current.set(...preset.target);
    active.current = true;
  }, [preset]);

  useFrame(() => {
    if (!active.current || !controls.current) return;
    camera.position.lerp(position.current, 0.075);
    controls.current.target.lerp(target.current, 0.075);
    controls.current.update();

    if (camera.position.distanceTo(position.current) < 1.5) {
      active.current = false;
      onSettled();
    }
  });

  return null;
}

/** Reports the camera bearing so the UI can rotate a north arrow. */
function CompassReporter({ onBearing }: { onBearing?: (deg: number) => void }) {
  const { camera } = useThree();
  const last = React.useRef(-999);

  useFrame(() => {
    if (!onBearing) return;
    const deg = (Math.atan2(camera.position.x, camera.position.z) * 180) / Math.PI;
    if (Math.abs(deg - last.current) > 0.7) {
      last.current = deg;
      onBearing(deg);
    }
  });

  return null;
}

/** Slow orbit for the non-interactive landing-page hero. */
function AutoOrbit({ enabled }: { enabled: boolean }) {
  const { camera } = useThree();
  useFrame((state) => {
    if (!enabled) return;
    const t = state.clock.elapsedTime * 0.055;
    const r = 352;
    camera.position.x = Math.sin(t) * r;
    camera.position.z = Math.cos(t) * r;
    camera.position.y = 205;
    camera.lookAt(0, 6, 0);
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
  preset,
  onPresetSettled,
  onBearing,
  className,
}: {
  buildings: TwinBuilding[];
  selectedId?: number | null;
  onSelect?: (id: number | null) => void;
  interactive?: boolean;
  autoRotate?: boolean;
  showLabels?: boolean;
  preset?: CameraPreset | null;
  onPresetSettled?: () => void;
  onBearing?: (deg: number) => void;
  className?: string;
}) {
  const [hovered, setHovered] = React.useState<number | null>(null);
  const [contextLost, setContextLost] = React.useState(false);
  const [generation, setGeneration] = React.useState(0);
  const controls = React.useRef<OrbitControlsImpl | null>(null);

  React.useEffect(
    () => () => {
      document.body.style.cursor = "auto";
    },
    [],
  );

  // A WebGL context can be dropped by the driver, by tab suspension, or by
  // running out of GPU memory. Fall back to a readable list rather than a
  // blank canvas, and offer to rebuild.
  if (contextLost) {
    return (
      <div className={className}>
        <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="max-w-sm space-y-1.5">
            <p className="text-sm font-medium text-ink">3D view unavailable</p>
            <p className="text-xs leading-relaxed text-ink-muted">
              The browser dropped the WebGL context. Block status is listed
              below, and the twin can be rebuilt.
            </p>
          </div>
          <ul className="w-full max-w-sm space-y-1.5">
            {buildings.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-[rgb(var(--line)/0.1)] bg-surface/50 px-3 py-2"
              >
                <button
                  onClick={() => onSelect?.(b.id)}
                  className="text-[12px] text-ink-soft hover:text-ink"
                >
                  {b.name}
                </button>
                <span className="font-mono text-[10px] text-ink-muted">
                  {b.status}
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
        shadows
        dpr={[1, 1.7]}
        camera={{
          position: DEFAULT_PRESET.position,
          fov: 30,
          near: 1,
          far: 1600,
        }}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
        onCreated={({ gl, scene }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.04;
          scene.fog = new THREE.Fog("#93a7ae", 620, 1150);
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
        <color attach="background" args={["#8fa5ad"]} />

        <CampusLighting />

        {/* ---- site ---- */}
        <CampusGround />
        <Quadrangle />
        <CampusPathways />
        <CampusLandmark />
        <CampusGate />
        <CampusTrees buildings={buildings} />
        <CampusShrubs />

        {/* ---- blocks ---- */}
        {buildings.map((building) => (
          <CampusBuilding
            key={building.id}
            building={building}
            selected={selectedId === building.id}
            hovered={hovered === building.id}
            dimmed={
              selectedId !== null &&
              selectedId !== undefined &&
              selectedId !== building.id
            }
            interactive={interactive}
            showLabel={showLabels}
            onSelect={(id) => onSelect?.(id)}
            onHover={setHovered}
          />
        ))}

        <ContactShadows
          position={[0, 0.22, 0]}
          opacity={0.34}
          scale={440}
          blur={2.6}
          far={52}
          resolution={1024}
          color="#1b2a20"
        />

        <CameraRig
          preset={preset ?? null}
          controls={controls}
          onSettled={() => onPresetSettled?.()}
        />
        <CompassReporter onBearing={onBearing} />

        {interactive ? (
          <OrbitControls
            ref={controls}
            enablePan
            minDistance={70}
            maxDistance={700}
            minPolarAngle={0.12}
            maxPolarAngle={Math.PI / 2.12}
            enableDamping
            dampingFactor={0.06}
            target={[0, 0, 4]}
            autoRotate={autoRotate}
            autoRotateSpeed={0.35}
            makeDefault
          />
        ) : (
          <AutoOrbit enabled={autoRotate} />
        )}
      </Canvas>
    </div>
  );
}
