import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { School, CELL, BODY_GLYPHS, WAKE_GLYPHS } from "./fish";

const MAX_CELLS = 3000;
const MAX_BLUR_CELLS = 1500;
const ATLAS_CHARS = [...BODY_GLYPHS, ...WAKE_GLYPHS];
const ATLAS_CELL = 48;

/** draws the glyph atlas from the loaded mono font. */
function buildAtlas(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_CHARS.length * ATLAS_CELL;
  canvas.height = ATLAS_CELL;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.font = '600 28px "JetBrains Mono", monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ATLAS_CHARS.forEach((ch, i) => {
      ctx.fillText(ch, (i + 0.5) * ATLAS_CELL, ATLAS_CELL / 2 + 1);
    });
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

/** soft round sprite, used for the out-of-focus tiles. */
function buildSprite(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
    grad.addColorStop(0, "rgba(255,255,255,1.0)");
    grad.addColorStop(0.35, "rgba(255,255,255,0.85)");
    grad.addColorStop(0.7, "rgba(255,255,255,0.35)");
    grad.addColorStop(1.0, "rgba(255,255,255,0.0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

const tileVertex = `
attribute vec3 aTileColor;
attribute float aTileAlpha;
varying vec2 vUv;
varying vec3 vTileColor;
varying float vTileAlpha;
void main() {
  vUv = uv;
  vTileColor = aTileColor;
  vTileAlpha = aTileAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const tileFragment = `
varying vec2 vUv;
varying vec3 vTileColor;
varying float vTileAlpha;
void main() {
  if (vTileAlpha < 0.01) discard;
  // rounded rectangle on 14px quad: 12.6px tile, 2.0px corner radius
  vec2 p = abs(vUv - 0.5) * 14.0;
  vec2 b = vec2(6.3, 6.3) - 2.0;
  vec2 q = p - b;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 2.0;
  float alpha = clamp(0.5 - d, 0.0, 1.0) * vTileAlpha;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(vTileColor, alpha);
}
`;

const glyphVertex = `
attribute float aGlyph;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uCols;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vUv = vec2((uv.x + aGlyph) / uCols, uv.y);
  vAlpha = aAlpha;
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const glyphFragment = `
uniform sampler2D uAtlas;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 tex = texture2D(uAtlas, vUv);
  float alpha = tex.a * vAlpha;
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(vColor, alpha);
}
`;

interface FieldProps {
  layer: "sharp" | "blur";
}

export function AsciiField({ layer }: FieldProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 1228, height: 692 });
  const [reducedMotion] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const schoolRef = useRef<School | null>(null);
  if (!schoolRef.current) schoolRef.current = new School(size.width, size.height, 42);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        schoolRef.current?.resize(rect.width, rect.height);
        setSize({ width: rect.width, height: rect.height });
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={hostRef} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} aria-hidden>
      <Canvas
        orthographic
        camera={{ left: -size.width / 2, right: size.width / 2, top: size.height / 2, bottom: -size.height / 2, near: -10, far: 10 }}
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
        style={{ background: "transparent", pointerEvents: "none" }}
      >
        {layer === "sharp" ? (
          <SharpFish school={schoolRef.current} width={size.width} height={size.height} reducedMotion={reducedMotion} />
        ) : (
          <BlurFish school={schoolRef.current} width={size.width} height={size.height} reducedMotion={reducedMotion} />
        )}
      </Canvas>
    </div>
  );
}

interface LayerProps {
  school: School;
  width: number;
  height: number;
  reducedMotion: boolean;
}

function SharpFish({ school, width, height, reducedMotion }: LayerProps) {
  const [atlasTick, setAtlasTick] = useState(0);
  const atlas = useMemo(() => buildAtlas(), [atlasTick]);

  useEffect(() => {
    let alive = true;
    document.fonts?.ready.then(() => {
      if (alive) setAtlasTick((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, []);

  const tileMesh = useMemo(() => {
    const geo = new THREE.PlaneGeometry(CELL, CELL);
    const tileColorAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CELLS * 3), 3);
    const tileAlphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CELLS), 1);
    tileColorAttr.setUsage(THREE.DynamicDrawUsage);
    tileAlphaAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aTileColor", tileColorAttr);
    geo.setAttribute("aTileAlpha", tileAlphaAttr);
    const mat = new THREE.ShaderMaterial({
      vertexShader: tileVertex,
      fragmentShader: tileFragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, MAX_CELLS);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    return mesh;
  }, []);

  const glyphMesh = useMemo(() => {
    const geo = new THREE.PlaneGeometry(CELL, CELL);
    const glyphAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CELLS), 1);
    const alphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CELLS), 1);
    const colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CELLS * 3), 3);
    glyphAttr.setUsage(THREE.DynamicDrawUsage);
    alphaAttr.setUsage(THREE.DynamicDrawUsage);
    colorAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aGlyph", glyphAttr);
    geo.setAttribute("aAlpha", alphaAttr);
    geo.setAttribute("aColor", colorAttr);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: atlas },
        uCols: { value: ATLAS_CHARS.length },
      },
      vertexShader: glyphVertex,
      fragmentShader: glyphFragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, MAX_CELLS);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    return mesh;
  }, [atlas]);

  const scratch = useMemo(() => ({
    matrix: new THREE.Matrix4(),
    color: new THREE.Color(),
    tileColor: new THREE.Color(),
  }), []);

  const drawn = useRef(false);

  useFrame((state) => {
    if (reducedMotion && drawn.current) return;
    if (document.hidden) return;
    const t = reducedMotion ? 0 : state.clock.elapsedTime;
    school.update(t);
    drawn.current = true;

    const n = school.cellCount;
    const dummy = scratch.matrix;
    const color = scratch.color;
    const tileColor = scratch.tileColor;

    const tileColorAttr = tileMesh.geometry.getAttribute("aTileColor") as THREE.InstancedBufferAttribute;
    const tileAlphaAttr = tileMesh.geometry.getAttribute("aTileAlpha") as THREE.InstancedBufferAttribute;

    const glyphIndexAttr = glyphMesh.geometry.getAttribute("aGlyph") as THREE.InstancedBufferAttribute;
    const alphaAttr = glyphMesh.geometry.getAttribute("aAlpha") as THREE.InstancedBufferAttribute;
    const colorAttr = glyphMesh.geometry.getAttribute("aColor") as THREE.InstancedBufferAttribute;

    for (let i = 0; i < n; i++) {
      const cell = school.cells[i];
      const x = cell.x + CELL / 2 - width / 2;
      const y = -(cell.y + CELL / 2) + height / 2;
      dummy.makeTranslation(x, y, 0);

      tileMesh.setMatrixAt(i, dummy);
      if (cell.tileColor) {
        tileColor.set(cell.tileColor);
        tileColorAttr.setXYZ(i, tileColor.r, tileColor.g, tileColor.b);
        tileAlphaAttr.setX(i, 1.0);
      } else {
        tileAlphaAttr.setX(i, 0.0);
      }

      glyphMesh.setMatrixAt(i, dummy);
      glyphIndexAttr.setX(i, Math.max(0, ATLAS_CHARS.indexOf(cell.glyph)));
      alphaAttr.setX(i, cell.alpha);
      color.set(cell.glyphColor);
      colorAttr.setXYZ(i, color.r, color.g, color.b);
    }

    tileMesh.count = n;
    tileMesh.instanceMatrix.needsUpdate = true;
    tileColorAttr.needsUpdate = true;
    tileAlphaAttr.needsUpdate = true;

    glyphMesh.count = n;
    glyphMesh.instanceMatrix.needsUpdate = true;
    glyphIndexAttr.needsUpdate = true;
    alphaAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
  });

  return (
    <>
      <primitive object={tileMesh} />
      <primitive object={glyphMesh} />
    </>
  );
}

function BlurFish({ school, width, height, reducedMotion }: LayerProps) {
  const sprite = useMemo(() => buildSprite(), []);
  const mesh = useMemo(() => {
    const geo = new THREE.PlaneGeometry(CELL * 1.55, CELL * 1.55);
    const mat = new THREE.MeshBasicMaterial({
      map: sprite,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      depthTest: false,
    });
    const instanced = new THREE.InstancedMesh(geo, mat, MAX_BLUR_CELLS);
    instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    instanced.frustumCulled = false;
    for (let i = 0; i < MAX_BLUR_CELLS; i++) instanced.setColorAt(i, new THREE.Color("#384058"));
    return instanced;
  }, [sprite]);

  const scratch = useMemo(() => ({
    matrix: new THREE.Matrix4(),
    color: new THREE.Color(),
  }), []);
  const drawn = useRef(false);

  useFrame((state) => {
    if (reducedMotion && drawn.current) return;
    if (document.hidden) return;
    const t = reducedMotion ? 0 : state.clock.elapsedTime;
    school.update(t);
    drawn.current = true;

    const n = school.blurCellCount;
    const dummy = scratch.matrix;
    const color = scratch.color;
    for (let i = 0; i < n; i++) {
      const cell = school.blurCells[i];
      const x = cell.x + CELL / 2 - width / 2;
      const y = -(cell.y + CELL / 2) + height / 2;
      dummy.makeTranslation(x, y, 0);
      mesh.setMatrixAt(i, dummy);
      mesh.setColorAt(i, color.set(cell.tileColor));
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return <primitive object={mesh} />;
}
