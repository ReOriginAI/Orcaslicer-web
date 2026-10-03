import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { BuildVolume, Transform } from "@orca-web/shared";
import { placeOnFace, positionMeshOnPlate } from "./placement";

export interface ModelBounds {
  width: number;
  depth: number;
  height: number;
  outsideBed: boolean;
  minZ: number;
}
interface ViewScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  resetView: () => void;
  mesh?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  bounds?: THREE.Box3Helper;
  originalCenter?: THREE.Vector3;
}

function disposeScene(scene: THREE.Scene) {
  scene.traverse((object) => {
    if ("geometry" in object && object.geometry instanceof THREE.BufferGeometry)
      object.geometry.dispose();
    if ("material" in object) {
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      materials.forEach((material) => {
        if (material instanceof THREE.Material) material.dispose();
      });
    }
  });
}

export function ModelViewer({
  file,
  volume,
  transform,
  onBounds,
  selectingFace,
  onFaceSelected,
  onSelectionCancel,
}: {
  file: File | null;
  volume?: BuildVolume;
  transform: Transform;
  onBounds: (bounds: ModelBounds | null) => void;
  selectingFace: boolean;
  onFaceSelected: (transform: Transform) => void;
  onSelectionCancel: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<ViewScene | null>(null);
  const transformRef = useRef(transform);
  const boundsCallback = useRef(onBounds);
  const faceSelectionRef = useRef(selectingFace);
  const faceCallback = useRef(onFaceSelected);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sceneReady, setSceneReady] = useState(0);
  const [minimumZ, setMinimumZ] = useState<number | null>(null);
  transformRef.current = transform;
  boundsCallback.current = onBounds;
  faceSelectionRef.current = selectingFace;
  faceCallback.current = onFaceSelected;

  function applyTransform() {
    const state = view.current;
    if (!state?.mesh || !volume) return;
    const mesh = state.mesh;
    const current = transformRef.current;
    const originalCenter = state.originalCenter ?? new THREE.Vector3();
    const box = positionMeshOnPlate(mesh, current, volume, originalCenter);
    setMinimumZ(box.min.z);
    const size = box.getSize(new THREE.Vector3());
    const outsideBed =
      box.min.x < -0.01 ||
      box.min.y < -0.01 ||
      box.max.x > volume.width + 0.01 ||
      box.max.y > volume.depth + 0.01 ||
      box.max.z > volume.height + 0.01 ||
      box.min.z < -0.01;
    if (state.bounds) {
      state.bounds.box.copy(box);
      const material = state.bounds.material as THREE.LineBasicMaterial;
      material.color.set(outsideBed ? "#c75a30" : "#578276");
    }
    boundsCallback.current({
      width: size.x,
      depth: size.y,
      height: size.z,
      outsideBed,
      minZ: box.min.z,
    });
    state.renderer.render(state.scene, state.camera);
  }

  useEffect(() => {
    const host = container.current;
    if (!host || !volume) return;
    const scene = new THREE.Scene();
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setError(
        "The 3D preview requires WebGL. You can still upload and slice your model.",
      );
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor("#edf1ef", 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    renderer.domElement.setAttribute(
      "aria-label",
      "Interactive model build plate. Drag to orbit, scroll to zoom.",
    );
    renderer.domElement.setAttribute("role", "img");
    const extent = Math.max(volume.width, volume.depth, volume.height);
    const camera = new THREE.PerspectiveCamera(39, 1, 0.1, extent * 20);
    camera.up.set(0, 0, 1);
    camera.position.set(
      volume.width / 2 + extent * 1.15,
      volume.depth / 2 - extent * 1.45,
      extent * 1.1,
    );
    const controls = new OrbitControls(camera, renderer.domElement);
    const raycaster = new THREE.Raycaster();
    let pointerStart: { x: number; y: number; id: number } | undefined;
    const pointerDown = (event: PointerEvent) => {
      if (event.button === 0 && faceSelectionRef.current)
        pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
    };
    const pointerUp = (event: PointerEvent) => {
      const start = pointerStart;
      pointerStart = undefined;
      const mesh = view.current?.mesh;
      if (!faceSelectionRef.current || !mesh || !start || start.id !== event.pointerId ||
          Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2(
        (event.clientX - rect.left) / rect.width * 2 - 1,
        -(event.clientY - rect.top) / rect.height * 2 + 1,
      ), camera);
      const hit = raycaster.intersectObject(mesh, false)[0];
      if (!hit?.face) return;
      const normal = hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)).normalize();
      if (normal.lengthSq() < 1e-12) return;
      faceCallback.current(placeOnFace(transformRef.current, normal));
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    controls.target.set(
      volume.width / 2,
      volume.depth / 2,
      volume.height * 0.12,
    );
    controls.minDistance = 10;
    controls.maxDistance = extent * 8;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controls.update();
    controls.saveState();
    const render = () => renderer.render(scene, camera);
    controls.addEventListener("change", render);
    let cameraAdjusted = false;
    const defaultTarget = controls.target.clone();
    const defaultOffset = camera.position.clone().sub(defaultTarget);
    const resetView = () => {
      // A tall, narrow viewer needs more camera distance to keep the plate in frame.
      const aspect = host.clientWidth / Math.max(host.clientHeight, 1);
      controls.target.copy(defaultTarget);
      camera.position
        .copy(defaultTarget)
        .add(defaultOffset.clone().multiplyScalar(Math.max(1, 1.15 / aspect)));
      controls.update();
      controls.saveState();
      cameraAdjusted = false;
      render();
    };
    controls.addEventListener("start", () => {
      cameraAdjusted = true;
    });
    scene.add(new THREE.HemisphereLight("#ffffff", "#839c8d", 2.3));
    const key = new THREE.DirectionalLight("#ffffff", 3.2);
    key.position.set(-100, -100, 400);
    scene.add(key);
    const fill = new THREE.DirectionalLight("#dcebe8", 1.2);
    fill.position.set(400, 200, 100);
    scene.add(fill);
    const bed = new THREE.Mesh(
      new THREE.BoxGeometry(volume.width, volume.depth, 2),
      new THREE.MeshStandardMaterial({ color: "#d9dfdc", roughness: 0.8 }),
    );
    bed.position.set(volume.width / 2, volume.depth / 2, -1.1);
    scene.add(bed);
    const points: number[] = [];
    for (let x = 0; x <= volume.width; x += 10)
      points.push(x, 0, 0.05, x, volume.depth, 0.05);
    for (let y = 0; y <= volume.depth; y += 10)
      points.push(0, y, 0.05, volume.width, y, 0.05);
    const gridGeometry = new THREE.BufferGeometry();
    gridGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(points, 3),
    );
    scene.add(
      new THREE.LineSegments(
        gridGeometry,
        new THREE.LineBasicMaterial({
          color: "#9eadA5",
          transparent: true,
          opacity: 0.5,
        }),
      ),
    );
    const cage = new THREE.Box3Helper(
      new THREE.Box3(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(volume.width, volume.depth, volume.height),
      ),
      new THREE.Color("#9cafA5"),
    );
    const cageMaterial = cage.material as THREE.LineBasicMaterial;
    cageMaterial.transparent = true;
    cageMaterial.opacity = 0.26;
    scene.add(cage);
    const axes = new THREE.AxesHelper(
      Math.min(volume.width, volume.depth) * 0.15,
    );
    axes.position.set(0, 0, 0.1);
    scene.add(axes);
    const resize = () => {
      const width = host.clientWidth;
      const height = Math.max(host.clientHeight, 1);
      if (!width) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (!cameraAdjusted) resetView();
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    view.current = { scene, camera, renderer, controls, resetView };
    setSceneReady((current) => current + 1);
    return () => {
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("pointerup", pointerUp);
      controls.dispose();
      disposeScene(scene);
      renderer.dispose();
      renderer.domElement.remove();
      view.current = null;
    };
  }, [volume?.width, volume?.depth, volume?.height]);

  useEffect(() => {
    let canceled = false;
    setLoaded(false);
    setMinimumZ(null);
    boundsCallback.current(null);
    const state = view.current;
    if (state) setError(null);
    if (state?.mesh) {
      state.scene.remove(state.mesh);
      state.mesh.geometry.dispose();
      state.mesh.material.dispose();
      state.mesh = undefined;
    }
    if (state?.bounds) {
      state.scene.remove(state.bounds);
      state.bounds.geometry.dispose();
      (state.bounds.material as THREE.Material).dispose();
      state.bounds = undefined;
    }
    if (!file || !state) return;
    if (!file.name.toLowerCase().endsWith(".stl")) {
      setError(
        "Preview is currently available for STL models. OrcaSlicer will handle this file during slicing.",
      );
      return;
    }
    void file
      .arrayBuffer()
      .then((data) => {
        if (canceled) return;
        // Check the declared binary size before the loader allocates vertex arrays.
        const binarySize =
          data.byteLength >= 84
            ? 84 + new DataView(data).getUint32(80, true) * 50
            : 0;
        const prefix = new TextDecoder().decode(
          new Uint8Array(data, 0, Math.min(data.byteLength, 9)),
        );
        if (binarySize !== data.byteLength && !/^[\s\S]{0,4}solid/.test(prefix))
          throw new Error("This STL has an invalid or incomplete header.");
        const geometry = new STLLoader().parse(data);
        geometry.computeBoundingBox();
        const box = geometry.boundingBox;
        if (
          !box ||
          ![...box.min.toArray(), ...box.max.toArray()].every(
            Number.isFinite,
          ) ||
          geometry.getAttribute("position").count < 3
        ) {
          geometry.dispose();
          throw new Error("This STL does not contain valid model geometry.");
        }
        state.originalCenter = box.getCenter(new THREE.Vector3());
        geometry.center();
        geometry.computeVertexNormals();
        const material = new THREE.MeshStandardMaterial({
          color: "#f5a966",
          metalness: 0.05,
          roughness: 0.55,
          side: THREE.DoubleSide,
        });
        state.mesh = new THREE.Mesh(geometry, material);
        state.scene.add(state.mesh);
        state.bounds = new THREE.Box3Helper(
          new THREE.Box3(),
          new THREE.Color("#578276"),
        );
        const boundsMaterial = state.bounds.material as THREE.LineBasicMaterial;
        boundsMaterial.transparent = true;
        boundsMaterial.opacity = 0.5;
        state.scene.add(state.bounds);
        applyTransform();
        setLoaded(true);
      })
      .catch((cause: unknown) => {
        if (!canceled)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not display this model.",
          );
      });
    return () => {
      canceled = true;
    };
  }, [file, sceneReady]);

  useEffect(() => {
    applyTransform();
  }, [transform, volume]);

  return (
    <section
      className="viewport"
      data-testid="model-preview"
      data-loaded={loaded}
      data-min-z={minimumZ?.toFixed(6)}
      aria-label="Model preview"
    >
      <div className="viewport-top">
        <div className="viewport-label">
          <span className="status-dot" />
          <span>Build plate</span>
        </div>
        {volume && (
          <span className="plate-dimensions">
            {volume.width} × {volume.depth} × {volume.height} mm
          </span>
        )}
      </div>
      <div ref={container} className={`scene-canvas${selectingFace ? " selecting-face" : ""}`} />
      {selectingFace && loaded && <div className="face-selection-notice" role="status">
        <span>Click or tap a flat face to place it on the bed. Drag to orbit.</span>
        <button type="button" className="text-button" onClick={onSelectionCancel}>Cancel</button>
      </div>}
      {!file && (
        <div className="viewport-empty">
          <span className="empty-cube" aria-hidden="true">
            ◇
          </span>
          <h2>Your next print starts here</h2>
          <p>Add a model to see it on the build plate.</p>
        </div>
      )}
      {file && !loaded && !error && (
        <p className="preview-notice" role="status">
          Loading model preview…
        </p>
      )}
      {error && (
        <p className="preview-notice" role="status">
          {error}
        </p>
      )}
      <div className="viewport-bottom">
        <span>Drag to orbit · Scroll to zoom · Right-drag to pan</span>
        <button
          className="view-reset"
          onClick={() => view.current?.resetView()}
          disabled={!volume}
        >
          Reset view
        </button>
      </div>
      {transform.autoOrient && file && (
        <p className="orient-note">
          Automatic orientation is applied by OrcaSlicer when slicing.
        </p>
      )}
    </section>
  );
}
