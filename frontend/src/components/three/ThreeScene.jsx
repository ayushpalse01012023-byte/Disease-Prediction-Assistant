import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// ————————————————————————————————————————————————
// Palette
// ————————————————————————————————————————————————
const BG_COLOR = '#030507';
const CORE_COLOR = '#05080b';
const DEEP_COLOR = '#071014';
const ENERGY = '#18dce8';
const ENERGY_DIM = '#0c6670';

// ————————————————————————————————————————————————
// Deterministic pseudo-random (build-time only, never per-frame)
// ————————————————————————————————————————————————
function hash(i, salt = 1) {
  const x = Math.sin(i * 12.9898 * salt) * 43758.5453;
  return x - Math.floor(x);
}

// ————————————————————————————————————————————————
// 1. HYPERCUBE PROJECTION
// A literal 4D tesseract, rotated independently in two 4D planes
// (XW and YZ) and perspective-projected into 3D each frame. This
// is the "higher-dimensional projection" concept made concrete:
// the visible 3D shape distorts in ways no ordinary 3D rotation
// can produce, because the source structure genuinely lives in
// one more dimension than what's rendered. Only 16 vertices / 32
// edges, so per-frame vertex updates are essentially free.
// ————————————————————————————————————————————————
const TESSERACT_VERTS_4D = (() => {
  const verts = [];
  for (let i = 0; i < 16; i++) {
    verts.push([
      i & 1 ? 1 : -1,
      i & 2 ? 1 : -1,
      i & 4 ? 1 : -1,
      i & 8 ? 1 : -1,
    ]);
  }
  return verts;
})();

const TESSERACT_EDGES = (() => {
  const edges = [];
  for (let a = 0; a < 16; a++) {
    for (let b = a + 1; b < 16; b++) {
      // Connected iff they differ in exactly one bit
      let diff = a ^ b;
      let bits = 0;
      while (diff) {
        bits += diff & 1;
        diff >>= 1;
      }
      if (bits === 1) edges.push([a, b]);
    }
  }
  return edges;
})();

function rotate4D(v, angleXW, angleYZ) {
  let [x, y, z, w] = v;

  // Rotate in the XW plane
  const cxw = Math.cos(angleXW);
  const sxw = Math.sin(angleXW);
  const x1 = x * cxw - w * sxw;
  const w1 = x * sxw + w * cxw;

  // Rotate in the YZ plane
  const cyz = Math.cos(angleYZ);
  const syz = Math.sin(angleYZ);
  const y1 = y * cyz - z * syz;
  const z1 = y * syz + z * cyz;

  return [x1, y1, z1, w1];
}

function project4Dto3D(v, wDistance = 2.4) {
  const [x, y, z, w] = v;
  const denom = wDistance - w;
  const scale = wDistance / (denom === 0 ? 0.0001 : denom);
  return [x * scale, y * scale, z * scale];
}

function HypercubeCore() {
  const lineRef = useRef();
  const kernelRef = useRef();
  const kernelMat = useRef();

  const geometry = useMemo(() => {
    const positions = new Float32Array(TESSERACT_EDGES.length * 2 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }, []);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();

    // Two independent, very slow 4D rotation rates — the source of
    // "topology changing without obvious deformation"
    const angleXW = t * 0.037;
    const angleYZ = t * 0.021;

    const scale = 1.35;
    const positions = geometry.attributes.position.array;

    let ptr = 0;
    for (let e = 0; e < TESSERACT_EDGES.length; e++) {
      const [ai, bi] = TESSERACT_EDGES[e];
      const a4 = rotate4D(TESSERACT_VERTS_4D[ai], angleXW, angleYZ);
      const b4 = rotate4D(TESSERACT_VERTS_4D[bi], angleXW, angleYZ);
      const a3 = project4Dto3D(a4);
      const b3 = project4Dto3D(b4);

      positions[ptr++] = a3[0] * scale;
      positions[ptr++] = a3[1] * scale;
      positions[ptr++] = a3[2] * scale;
      positions[ptr++] = b3[0] * scale;
      positions[ptr++] = b3[1] * scale;
      positions[ptr++] = b3[2] * scale;
    }
    geometry.attributes.position.needsUpdate = true;

    if (kernelRef.current) {
      kernelRef.current.rotation.x = t * 0.16;
      kernelRef.current.rotation.y = t * 0.11;
    }
    if (kernelMat.current) {
      // A "computation cycle": most of the time near-dormant, with
      // rare, brief, sharp intensifications — not a smooth pulse.
      const cycle = (t * 0.12) % (Math.PI * 2);
      const spike = Math.pow(Math.max(0, Math.sin(cycle)), 10);
      kernelMat.current.emissiveIntensity = 0.22 + spike * 0.5;
    }
  });

  return (
    <group>
      <lineSegments ref={lineRef} geometry={geometry}>
        <lineBasicMaterial color={ENERGY} transparent opacity={0.16} />
      </lineSegments>

      <mesh ref={kernelRef}>
        <icosahedronGeometry args={[0.46, 3]} />
        <meshStandardMaterial
          ref={kernelMat}
          color={CORE_COLOR}
          emissive={ENERGY}
          emissiveIntensity={0.22}
          roughness={0.9}
          metalness={0.15}
        />
      </mesh>
    </group>
  );
}

// ————————————————————————————————————————————————
// 2. FOLDING MANIFOLD
// A single torus-knot centerline whose cross-section offset is
// modulated by a hidden fourth parameter (a slow, independent
// phase) rather than a fixed radius. The band appears to fold and
// unfold through itself — dimensional folding rendered as a
// continuously recomputed BufferGeometry, not a discrete object.
// ————————————————————————————————————————————————
const MANIFOLD_SEGMENTS = 260;

function FoldingManifold() {
  const meshRef = useRef();

  const geometry = useMemo(() => {
    const positions = new Float32Array((MANIFOLD_SEGMENTS + 1) * 2 * 3);
    const indices = [];
    for (let i = 0; i < MANIFOLD_SEGMENTS; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      indices.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(indices);
    return geo;
  }, []);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    const positions = geometry.attributes.position.array;

    // The "hidden dimension" phase — independent, very slow
    const foldPhase = t * 0.05;

    let ptr = 0;
    for (let i = 0; i <= MANIFOLD_SEGMENTS; i++) {
      const u = (i / MANIFOLD_SEGMENTS) * Math.PI * 2;
      const knotP = 2, knotQ = 3;

      // Fold factor: width oscillates through zero, so the band
      // appears to pinch closed and reopen on the far side —
      // "beginning/end" become ambiguous rather than fixed.
      const fold = Math.sin(u * 3 + foldPhase) * 0.5 + 0.5;
      const width = 0.03 + fold * 0.05;

      const r = 2.0 + Math.cos(knotQ * u) * 0.5;
      const cx = r * Math.cos(knotP * u);
      const cy = r * Math.sin(knotP * u);
      const cz = Math.sin(knotQ * u) * 0.85;

      const u2 = u + 0.01;
      const r2 = 2.0 + Math.cos(knotQ * u2) * 0.5;
      const cx2 = r2 * Math.cos(knotP * u2);
      const cy2 = r2 * Math.sin(knotP * u2);
      const cz2 = Math.sin(knotQ * u2) * 0.85;

      const tangent = new THREE.Vector3(cx2 - cx, cy2 - cy, cz2 - cz).normalize();
      const up = new THREE.Vector3(0, 0, 1);
      const normal = new THREE.Vector3().crossVectors(tangent, up).normalize();
      const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();

      const twist = u * 4 + foldPhase * 2;
      const wx = Math.cos(twist) * width;
      const wy = Math.sin(twist) * width;
      const offset = normal.multiplyScalar(wx).add(binormal.multiplyScalar(wy));

      positions[ptr++] = cx + offset.x;
      positions[ptr++] = cy + offset.y;
      positions[ptr++] = cz + offset.z;
      positions[ptr++] = cx - offset.x;
      positions[ptr++] = cy - offset.y;
      positions[ptr++] = cz - offset.z;
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();

    if (meshRef.current) {
      // Independent, near-imperceptible drift — not synced to
      // anything else in the scene
      meshRef.current.rotation.y = t * 0.008;
      meshRef.current.rotation.x = Math.sin(t * 0.017) * 0.15;
    }
  });

  return (
    <mesh ref={meshRef} geometry={geometry}>
      <meshBasicMaterial
        color={ENERGY_DIM}
        transparent
        opacity={0.14}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

// ————————————————————————————————————————————————
// 3. RECURSIVE ECHO
// Three nested tetrahedral frames at shrinking scale, each on a
// distinct axis and speed. Kept small and few so it reads as an
// "impossible" detail noticed on a second look, not a focal
// object.
// ————————————————————————————————————————————————
function RecursiveEcho() {
  const refs = useRef([]);
  const levels = useMemo(
    () => [
      { scale: 1, axis: [0.6, 0.9, 0.2], speed: 0.02 },
      { scale: 0.68, axis: [-0.3, 0.5, 1.1], speed: -0.031 },
      { scale: 0.42, axis: [1.0, -0.4, 0.3], speed: 0.045 },
    ],
    []
  );

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    levels.forEach((lvl, i) => {
      const g = refs.current[i];
      if (g) {
        g.rotation.x = lvl.axis[0] * t * lvl.speed;
        g.rotation.y = lvl.axis[1] * t * lvl.speed;
        g.rotation.z = lvl.axis[2] * t * lvl.speed * 0.5;
      }
    });
  });

  return (
    <group position={[0.7, -0.35, 0.5]}>
      {levels.map((lvl, i) => (
        <group key={i} ref={(el) => (refs.current[i] = el)} scale={lvl.scale}>
          <mesh>
            <tetrahedronGeometry args={[0.5, 0]} />
            <meshBasicMaterial
              color={ENERGY}
              wireframe
              transparent
              opacity={0.12 - i * 0.02}
              depthWrite={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ————————————————————————————————————————————————
// 4. INFORMATION FIELD
// Instanced particles on independent parametric paths. A slow
// convergence phase pulls each toward the core and back out; a
// separate, rarer phase makes small clusters briefly vanish and
// re-appear elsewhere — implying computation being routed rather
// than continuous orbiting.
// ————————————————————————————————————————————————
const FLOW_COUNT = 140;

function InformationField() {
  const meshRef = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const particles = useMemo(() => {
    const arr = [];
    for (let i = 0; i < FLOW_COUNT; i++) {
      arr.push({
        freqA: 1 + Math.floor(hash(i, 1) * 4),
        freqB: 1 + Math.floor(hash(i, 2) * 4),
        freqC: 1 + Math.floor(hash(i, 3) * 4),
        phase: hash(i, 4) * Math.PI * 2,
        baseRadius: 1.5 + hash(i, 5) * 2.3,
        convergeSpeed: 0.04 + hash(i, 6) * 0.06,
        convergePhase: hash(i, 7) * Math.PI * 2,
        speed: 0.04 + hash(i, 8) * 0.09,
        vanishPhase: hash(i, 9) * Math.PI * 2,
        vanishSpeed: 0.015 + hash(i, 10) * 0.02,
      });
    }
    return arr;
  }, []);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    if (!meshRef.current) return;

    for (let i = 0; i < FLOW_COUNT; i++) {
      const p = particles[i];
      const angle = t * p.speed + p.phase;

      const converge =
        0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * p.convergeSpeed + p.convergePhase));
      const radius = p.baseRadius * converge;

      const x = Math.sin(p.freqA * angle) * radius;
      const y = Math.sin(p.freqB * angle + p.phase) * radius * 0.55;
      const z = Math.cos(p.freqC * angle) * radius;

      // Rare, brief disappearance — routed elsewhere, not destroyed
      const vanishCycle = (t * p.vanishSpeed + p.vanishPhase) % (Math.PI * 2);
      const visible = Math.pow(Math.max(0, Math.sin(vanishCycle)), 3);

      dummy.position.set(x, y, z);
      dummy.scale.setScalar(Math.max(0.001, 0.5 * visible + 0.08));
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[null, null, FLOW_COUNT]}>
      <sphereGeometry args={[0.014, 5, 5]} />
      <meshBasicMaterial color={ENERGY} transparent opacity={0.4} />
    </instancedMesh>
  );
}

// ————————————————————————————————————————————————
// Sparse nodes with transient connections — reduced count, kept
// deliberately minimal so it doesn't read as a network diagram.
// ————————————————————————————————————————————————
const NODE_COUNT = 6;

function ComputationalNodes() {
  const nodeRefs = useRef([]);
  const matRefs = useRef([]);
  const lineRefs = useRef([]);

  const nodes = useMemo(() => {
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    return new Array(NODE_COUNT).fill(0).map((_, i) => {
      const radius = 2.0 + hash(i, 31) * 1.5;
      const inclination = Math.acos(1 - 2 * ((i + 0.5) / NODE_COUNT));
      const azimuth = goldenAngle * i * 1.9;
      return {
        position: [
          radius * Math.sin(inclination) * Math.cos(azimuth),
          radius * Math.sin(inclination) * Math.sin(azimuth),
          radius * Math.cos(inclination),
        ],
        phase: hash(i, 32) * Math.PI * 2,
        freq: 0.3 + hash(i, 33) * 0.4,
      };
    });
  }, []);

  const links = useMemo(
    () => [
      { a: 0, b: 3, phase: 0.4, speed: 0.07 },
      { a: 1, b: 4, phase: 2.6, speed: 0.05 },
    ],
    []
  );

  const linkGeometries = useMemo(
    () =>
      links.map((l) =>
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(...nodes[l.a].position),
          new THREE.Vector3(...nodes[l.b].position),
        ])
      ),
    [links, nodes]
  );

  useFrame((state) => {
    const t = state.clock.getElapsedTime();

    nodes.forEach((n, i) => {
      const pulse = 0.2 + Math.sin(t * n.freq + n.phase) * 0.15 + 0.15;
      if (matRefs.current[i]) matRefs.current[i].emissiveIntensity = pulse;
      if (nodeRefs.current[i]) {
        const s = 1 + Math.sin(t * n.freq * 1.3 + n.phase) * 0.15;
        nodeRefs.current[i].scale.setScalar(s);
      }
    });

    links.forEach((l, i) => {
      const cycle = (t * l.speed + l.phase) % (Math.PI * 2);
      const flicker = Math.pow(Math.max(0, Math.sin(cycle)), 6);
      const mat = lineRefs.current[i];
      if (mat) mat.opacity = flicker * 0.45;
    });
  });

  return (
    <group>
      {nodes.map((n, i) => (
        <mesh key={i} ref={(el) => (nodeRefs.current[i] = el)} position={n.position}>
          <octahedronGeometry args={[0.03, 0]} />
          <meshStandardMaterial
            ref={(el) => (matRefs.current[i] = el)}
            color={DEEP_COLOR}
            emissive={ENERGY}
            emissiveIntensity={0.25}
            roughness={0.7}
            metalness={0.25}
          />
        </mesh>
      ))}
      {linkGeometries.map((geo, i) => (
        <line key={i} geometry={geo}>
          <lineBasicMaterial
            ref={(el) => (lineRefs.current[i] = el)}
            color={ENERGY}
            transparent
            opacity={0}
          />
        </line>
      ))}
    </group>
  );
}

// ————————————————————————————————————————————————
// Scale implication — minimal, thin, mostly off-frame
// ————————————————————————————————————————————————
function ScaleImplications() {
  const axesGeo = useMemo(() => {
    const dirs = [
      [1, 0.2, -0.1],
      [-0.5, 0.8, 0.4],
    ];
    return dirs.map((d) => {
      const dir = new THREE.Vector3(...d).normalize();
      const length = 8.5;
      return new THREE.BufferGeometry().setFromPoints([
        dir.clone().multiplyScalar(-length),
        dir.clone().multiplyScalar(length),
      ]);
    });
  }, []);

  const ref = useRef();
  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    if (ref.current) ref.current.rotation.y = t * 0.002;
  });

  return (
    <group ref={ref}>
      {axesGeo.map((geo, i) => (
        <line key={i} geometry={geo}>
          <lineBasicMaterial color={ENERGY_DIM} transparent opacity={0.035} />
        </line>
      ))}
    </group>
  );
}

// ————————————————————————————————————————————————
// Scene — no shared parent rotation, every system independent
// ————————————————————————————————————————————————
function Scene() {
  return (
    <group>
      <HypercubeCore />
      <FoldingManifold />
      <RecursiveEcho />
      <InformationField />
      <ComputationalNodes />
      <ScaleImplications />
    </group>
  );
}

// ————————————————————————————————————————————————
// Exported component — responsive via Canvas' built-in resize
// handling, no fixed pixel dimensions anywhere.
// ————————————————————————————————————————————————
export default function ThreeScene() {
  return (
    <Canvas
      dpr={[1, 1.75]}
      gl={{ antialias: true }}
      camera={{ position: [3.5, 1.3, 4.5], fov: 38, near: 0.1, far: 120 }}
      style={{ width: '100%', height: '100%', background: BG_COLOR }}
    >
      <color attach="background" args={[BG_COLOR]} />

      <ambientLight intensity={0.04} />
      <directionalLight position={[4, 5, 2]} intensity={0.08} color={'#3d5a61'} />
      <pointLight position={[0, 0, 0]} intensity={0.95} distance={4.5} color={ENERGY} />
      <pointLight position={[1.1, -0.7, 1.4]} intensity={0.2} distance={3} color={ENERGY_DIM} />

      <Scene />
    </Canvas>
  );
}