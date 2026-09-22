"use client";

import * as React from "react";
import * as THREE from "three";

import {
  PALETTE,
  PATHS,
  PLANTERS,
  QUAD,
  SITE,
  generateTrees,
  type TreeInstance,
  type TwinBuilding,
} from "./campus-data";

/**
 * The campus as a place, rather than a grid with boxes on it.
 *
 * Everything here is ground-plane work: grass, the paved quadrangle, the
 * pedestrian network, planting beds, the north road, and instanced vegetation.
 * It is what makes the twin read as somewhere a student has actually walked.
 */

// --------------------------------------------------------------------------
// Ground + paving
// --------------------------------------------------------------------------
export function CampusGround() {
  const w = SITE.maxX - SITE.minX + 180;
  const d = SITE.maxZ - SITE.minZ + 180;
  const cx = (SITE.minX + SITE.maxX) / 2;
  const cz = (SITE.minZ + SITE.maxZ) / 2;

  return (
    <group>
      {/* base terrain */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[cx, -0.04, cz]}
        receiveShadow
      >
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color={PALETTE.grass} roughness={0.96} metalness={0} />
      </mesh>

      {/* darker mown band so the site does not read as one flat colour */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <planeGeometry args={[SITE.maxX - SITE.minX + 40, SITE.maxZ - SITE.minZ + 40]} />
        <meshStandardMaterial color={PALETTE.grassDark} roughness={0.95} />
      </mesh>

      {/* north campus road */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, -92]}>
        <planeGeometry args={[260, 11]} />
        <meshStandardMaterial color={PALETTE.road} roughness={0.88} />
      </mesh>
      {[-97.5, -86.5].map((z) => (
        <mesh key={z} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, z]}>
          <planeGeometry args={[260, 0.7]} />
          <meshStandardMaterial color={PALETTE.kerb} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * The quadrangle.
 *
 * Large, paved, bordered by planting, with a banded surface pattern so it
 * reads as a designed plaza rather than a grey rectangle. This is the anchor
 * of the whole model, so it gets more attention than anything else at ground
 * level.
 */
export function Quadrangle() {
  const bands = React.useMemo(
    () => Array.from({ length: 7 }, (_, i) => -QUAD.depth / 2 + (i + 0.5) * (QUAD.depth / 7)),
    [],
  );

  return (
    <group position={[QUAD.x, 0, QUAD.z]}>
      {/* main paved surface */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} receiveShadow>
        <planeGeometry args={[QUAD.width, QUAD.depth]} />
        <meshStandardMaterial color={PALETTE.paving} roughness={0.9} metalness={0.02} />
      </mesh>

      {/* paving bands: subtle tonal stripes across the plaza */}
      {bands.map((z, i) =>
        i % 2 === 0 ? (
          <mesh key={z} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, z]}>
            <planeGeometry args={[QUAD.width - 4, QUAD.depth / 14]} />
            <meshStandardMaterial color={PALETTE.pavingLight} roughness={0.88} />
          </mesh>
        ) : null,
      )}

      {/* central lawn panel */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <planeGeometry args={[QUAD.width * 0.52, QUAD.depth * 0.46]} />
        <meshStandardMaterial color="#47603f" roughness={0.95} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
        <ringGeometry args={[QUAD.depth * 0.23, QUAD.depth * 0.235, 64]} />
        <meshStandardMaterial color={PALETTE.kerb} roughness={0.9} side={THREE.DoubleSide} />
      </mesh>

      {/* kerb line around the plaza */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.045, 0]}>
        <ringGeometry args={[0, 1, 4]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  );
}

/** Pedestrian walkways and the landscaped strips that edge them. */
export function CampusPathways() {
  return (
    <group>
      {PATHS.map((p, i) => (
        <mesh
          key={`path-${i}`}
          rotation={[-Math.PI / 2, 0, p.rotation ?? 0]}
          position={[p.x, 0.015, p.z]}
          receiveShadow
        >
          <planeGeometry args={[p.w, p.d]} />
          <meshStandardMaterial color={PALETTE.path} roughness={0.92} />
        </mesh>
      ))}

      {PLANTERS.map((p, i) => (
        <mesh
          key={`planter-${i}`}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[p.x, 0.05, p.z]}
        >
          <planeGeometry args={[p.w, p.d]} />
          <meshStandardMaterial color={PALETTE.planter} roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
}

// --------------------------------------------------------------------------
// Vegetation
// --------------------------------------------------------------------------
/**
 * Instanced planting.
 *
 * Three canopy tones and a shared trunk mesh, drawn as two InstancedMesh calls
 * regardless of how many trees there are. 170-odd trees cost the same as two.
 */
export function CampusTrees({ buildings }: { buildings: TwinBuilding[] }) {
  const trees: TreeInstance[] = React.useMemo(
    () => generateTrees(buildings, 150),
    [buildings],
  );

  const trunkRef = React.useRef<THREE.InstancedMesh>(null);
  const canopyRef = React.useRef<THREE.InstancedMesh>(null);

  React.useEffect(() => {
    const dummy = new THREE.Object3D();
    const colour = new THREE.Color();
    const tones = [PALETTE.foliageA, PALETTE.foliageB, PALETTE.foliageC];

    trees.forEach((t, i) => {
      const height = 5.5 * t.scale;

      dummy.position.set(t.x, height * 0.42, t.z);
      dummy.rotation.set(0, t.rotation, 0);
      dummy.scale.set(t.scale, t.scale, t.scale);
      dummy.updateMatrix();
      trunkRef.current?.setMatrixAt(i, dummy.matrix);

      dummy.position.set(t.x, height + 1.4 * t.scale, t.z);
      dummy.rotation.set(t.rotation * 0.4, t.rotation, t.rotation * 0.2);
      dummy.scale.setScalar(t.scale * (0.9 + (t.kind * 0.12)));
      dummy.updateMatrix();
      canopyRef.current?.setMatrixAt(i, dummy.matrix);
      canopyRef.current?.setColorAt(i, colour.set(tones[t.kind]));
    });

    if (trunkRef.current) trunkRef.current.instanceMatrix.needsUpdate = true;
    if (canopyRef.current) {
      canopyRef.current.instanceMatrix.needsUpdate = true;
      if (canopyRef.current.instanceColor) {
        canopyRef.current.instanceColor.needsUpdate = true;
      }
    }
  }, [trees]);

  return (
    <group>
      <instancedMesh
        ref={trunkRef}
        args={[undefined, undefined, trees.length]}
        castShadow
      >
        <cylinderGeometry args={[0.32, 0.46, 5.5, 6]} />
        <meshStandardMaterial color={PALETTE.trunk} roughness={0.95} />
      </instancedMesh>

      <instancedMesh
        ref={canopyRef}
        args={[undefined, undefined, trees.length]}
        castShadow
      >
        <icosahedronGeometry args={[3.4, 0]} />
        <meshStandardMaterial roughness={0.88} flatShading />
      </instancedMesh>
    </group>
  );
}

/** Low shrub beds along the quadrangle edge. */
export function CampusShrubs() {
  const shrubs = React.useMemo(() => {
    const out: { x: number; z: number; s: number }[] = [];
    const halfW = QUAD.width / 2 + 1.6;
    const halfD = QUAD.depth / 2 + 1.6;
    for (let i = 0; i < 26; i += 1) {
      const t = (i + 0.5) / 26;
      out.push({ x: -halfW + t * (QUAD.width + 3.2), z: -halfD, s: 0.8 + (i % 3) * 0.16 });
      out.push({ x: -halfW + t * (QUAD.width + 3.2), z: halfD, s: 0.8 + ((i + 1) % 3) * 0.16 });
    }
    for (let i = 0; i < 18; i += 1) {
      const t = (i + 0.5) / 18;
      out.push({ x: -halfW, z: -halfD + t * (QUAD.depth + 3.2), s: 0.78 + (i % 3) * 0.15 });
      out.push({ x: halfW, z: -halfD + t * (QUAD.depth + 3.2), s: 0.78 + ((i + 2) % 3) * 0.15 });
    }
    return out;
  }, []);

  const ref = React.useRef<THREE.InstancedMesh>(null);

  React.useEffect(() => {
    const dummy = new THREE.Object3D();
    shrubs.forEach((s, i) => {
      dummy.position.set(s.x, 0.55 * s.s, s.z);
      dummy.scale.set(s.s, s.s * 0.78, s.s);
      dummy.rotation.set(0, i * 0.7, 0);
      dummy.updateMatrix();
      ref.current?.setMatrixAt(i, dummy.matrix);
    });
    if (ref.current) ref.current.instanceMatrix.needsUpdate = true;
  }, [shrubs]);

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, shrubs.length]}>
      <icosahedronGeometry args={[1.15, 0]} />
      <meshStandardMaterial color="#3a6136" roughness={0.92} flatShading />
    </instancedMesh>
  );
}

// --------------------------------------------------------------------------
// Landmarks
// --------------------------------------------------------------------------
/**
 * Central quadrangle landmark.
 *
 * A tiered plinth and flagpole. The campus walkthrough video was not among the
 * files this build received, so the statue referenced in the brief could not be
 * confirmed -- rather than invent a sculpture, this is the generic plinth and
 * flagstaff that anchors most Indian campus quadrangles. It is a single
 * component and can be swapped for a modelled statue once the video is available.
 */
export function CampusLandmark() {
  return (
    <group position={[QUAD.x, 0, QUAD.z]}>
      <mesh position={[0, 0.35, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[5.2, 5.8, 0.7, 24]} />
        <meshStandardMaterial color="#b9b6ab" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.95, 0]} castShadow>
        <cylinderGeometry args={[3.4, 3.9, 0.6, 24]} />
        <meshStandardMaterial color="#c8c5b8" roughness={0.88} />
      </mesh>
      <mesh position={[0, 1.9, 0]} castShadow>
        <boxGeometry args={[2.4, 1.4, 2.4]} />
        <meshStandardMaterial color="#9d9a90" roughness={0.85} />
      </mesh>
      {/* flagstaff */}
      <mesh position={[0, 8.0, 0]} castShadow>
        <cylinderGeometry args={[0.13, 0.18, 11.5, 10]} />
        <meshStandardMaterial color="#d6d4cc" roughness={0.45} metalness={0.5} />
      </mesh>
      <mesh position={[1.6, 12.6, 0]}>
        <planeGeometry args={[3.0, 1.9]} />
        <meshStandardMaterial
          color="#e07b3c"
          roughness={0.8}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

/** Campus gate on the north road, giving the site an entrance. */
export function CampusGate() {
  return (
    <group position={[-6, 0, -84]}>
      {[-9, 9].map((x) => (
        <mesh key={x} position={[x, 3.4, 0]} castShadow>
          <boxGeometry args={[2.2, 6.8, 2.2]} />
          <meshStandardMaterial color="#d9d3c4" roughness={0.85} />
        </mesh>
      ))}
      <mesh position={[0, 7.4, 0]} castShadow>
        <boxGeometry args={[22, 1.1, 2.6]} />
        <meshStandardMaterial color="#8d8b86" roughness={0.7} metalness={0.15} />
      </mesh>
    </group>
  );
}
