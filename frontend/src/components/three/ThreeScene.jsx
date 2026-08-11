import { Canvas, useFrame } from "@react-three/fiber";
import { useRef } from "react";

function DiagnosticCore() {
  const coreRef = useRef();
  const ringGroupRef = useRef();
  const innerRingRef = useRef();
  const outerRingRef = useRef();

  useFrame((_, delta) => {
    if (ringGroupRef.current) {
      ringGroupRef.current.rotation.y += delta * 0.08;
    }
    if (innerRingRef.current) {
      innerRingRef.current.rotation.x += delta * 0.05;
    }
    if (outerRingRef.current) {
      outerRingRef.current.rotation.z -= delta * 0.03;
    }
    if (coreRef.current) {
      coreRef.current.rotation.y += delta * 0.04;
    }
  });

  return (
    <group>
      {/* Central diagnostic core */}
      <mesh ref={coreRef}>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial
          color="#12161c"
          metalness={0.3}
          roughness={0.75}
        />
      </mesh>

      {/* Cyan diagnostic markers on the core surface */}
      <mesh>
        <icosahedronGeometry args={[1.002, 1]} />
        <meshStandardMaterial
          color="#2fb8c6"
          wireframe
          transparent
          opacity={0.15}
          roughness={1}
        />
      </mesh>

      {/* Rotating ring structures around the core */}
      <group ref={ringGroupRef}>
        <mesh ref={innerRingRef} rotation={[Math.PI / 2.4, 0, 0]}>
          <torusGeometry args={[1.8, 0.015, 16, 128]} />
          <meshStandardMaterial
            color="#1d5e66"
            emissive="#2fb8c6"
            emissiveIntensity={0.3}
            metalness={0.4}
            roughness={0.5}
          />
        </mesh>

        <mesh ref={outerRingRef} rotation={[Math.PI / 3, Math.PI / 6, 0]}>
          <torusGeometry args={[2.4, 0.01, 16, 128]} />
          <meshStandardMaterial
            color="#161b22"
            emissive="#2fb8c6"
            emissiveIntensity={0.15}
            metalness={0.3}
            roughness={0.6}
          />
        </mesh>

        <mesh rotation={[Math.PI / 1.8, Math.PI / 4, 0]}>
          <torusGeometry args={[2.9, 0.008, 16, 128]} />
          <meshStandardMaterial
            color="#10141a"
            emissive="#2fb8c6"
            emissiveIntensity={0.1}
            metalness={0.2}
            roughness={0.7}
          />
        </mesh>
      </group>

      {/* Small cyan diagnostic markers along the inner ring */}
      {Array.from({ length: 8 }).map((_, i) => {
        const angle = (i / 8) * Math.PI * 2;
        const radius = 1.8;
        return (
          <mesh
            key={i}
            position={[
              Math.cos(angle) * radius,
              Math.sin(angle) * radius * 0.3,
              Math.sin(angle) * radius,
            ]}
          >
            <sphereGeometry args={[0.02, 8, 8]} />
            <meshStandardMaterial
              color="#2fb8c6"
              emissive="#2fb8c6"
              emissiveIntensity={0.8}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function ThreeScene() {
  return (
    <div className="three-scene">
      <Canvas
        camera={{ position: [0, 0, 6], fov: 45 }}
        gl={{ antialias: true }}
      >
        <color attach="background" args={["#0a0d10"]} />

        <ambientLight intensity={0.25} color="#a7b2bd" />
        <directionalLight
          position={[4, 5, 3]}
          intensity={0.6}
          color="#e7ecf0"
        />
        <pointLight position={[-3, -2, -4]} intensity={0.3} color="#2fb8c6" />

        <DiagnosticCore />
      </Canvas>
    </div>
  );
}

export default ThreeScene;