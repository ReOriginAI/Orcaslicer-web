import { Box3, Euler, MathUtils, Mesh, Quaternion, Vector3 } from "three";
import type { BuildVolume, Transform } from "@orca-web/shared";

export type Axis = "x" | "y" | "z";

export function orientation(transform: Transform): Quaternion {
  return new Quaternion().setFromEuler(new Euler(
    MathUtils.degToRad(transform.rotation.x),
    MathUtils.degToRad(transform.rotation.y),
    MathUtils.degToRad(transform.rotation.z),
    "ZYX",
  ));
}

function onBed(transform: Transform, quaternion: Quaternion): Transform {
  const euler = new Euler().setFromQuaternion(quaternion.normalize(), "ZYX");
  const degrees = (angle: number) => {
    const value = MathUtils.radToDeg(angle);
    return Math.abs(value) < 1e-10 ? 0 : value;
  };
  return {
    ...transform,
    rotation: { x: degrees(euler.x), y: degrees(euler.y), z: degrees(euler.z) },
    ensureOnBed: true,
    autoOrient: false,
  };
}

/** Compose a turn around a build-plate axis, including an already tilted model. */
export function turnOnAxis(transform: Transform, axis: Axis, degrees: number): Transform {
  const direction = new Vector3(axis === "x" ? 1 : 0, axis === "y" ? 1 : 0, axis === "z" ? 1 : 0);
  const turn = new Quaternion().setFromAxisAngle(direction, MathUtils.degToRad(degrees));
  return onBed(transform, turn.multiply(orientation(transform)));
}

/** Point the selected face's outward world normal down toward the build plate. */
export function placeOnFace(transform: Transform, worldNormal: Vector3): Transform {
  if (!worldNormal.toArray().every(Number.isFinite) || worldNormal.lengthSq() < 1e-12)
    throw new Error("Select a valid flat face on the model.");
  const alignment = new Quaternion().setFromUnitVectors(worldNormal.clone().normalize(), new Vector3(0, 0, -1));
  return onBed(transform, alignment.multiply(orientation(transform)));
}

/** Match the server's placement using actual vertices instead of rotated box corners. */
export function positionMeshOnPlate(mesh: Mesh, transform: Transform, volume: BuildVolume, originalCenter: Vector3): Box3 {
  mesh.quaternion.copy(orientation(transform));
  mesh.scale.setScalar(transform.scale);
  mesh.position.set(0, 0, 0);
  mesh.updateMatrixWorld(true);
  const box = new Box3().setFromObject(mesh, true);
  mesh.position.set(
    transform.autoArrange ? volume.width / 2 : originalCenter.x,
    transform.autoArrange ? volume.depth / 2 : originalCenter.y,
    transform.ensureOnBed ? -box.min.z : originalCenter.z,
  );
  mesh.updateMatrixWorld(true);
  // Translating these exact bounds avoids a second scan of a potentially large mesh.
  return box.translate(mesh.position);
}
