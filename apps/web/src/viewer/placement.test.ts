import { describe, expect, it } from 'vitest';
import { BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { orientation, placeOnFace, positionMeshOnPlate, turnOnAxis } from './placement.js';
import { transformSchema } from '@orca-web/shared';

const volume = { width: 220, depth: 220, height: 245 };
function irregularMesh() {
  const geometry = new BufferGeometry();
  // A tetrahedron has no vertex at most corners of its axis-aligned bounds.
  geometry.setAttribute('position', new Float32BufferAttribute([
    0,0,25, 0,20,25, 40,0,25,
    0,0,25, 40,0,25, 0,0,55,
    0,0,25, 0,0,55, 0,20,25,
    40,0,25, 0,20,25, 0,0,55,
  ], 3));
  geometry.computeBoundingBox();
  const center = geometry.boundingBox!.getCenter(new Vector3());
  geometry.center();
  return { mesh: new Mesh(geometry, new MeshBasicMaterial()), center };
}

describe('face and axis placement', () => {
  it.each(['x', 'y', 'z'] as const)('composes a flip around world %s after an existing tilt', (axis) => {
    const previous = transformSchema.parse({ rotation: { x: 23, y: 37, z: -11 }, autoOrient: true, ensureOnBed: false, scale: 1.7 });
    const flipped = turnOnAxis(previous, axis, 180);
    const before = new Vector3(1, 2, 3).applyQuaternion(orientation(previous));
    const after = new Vector3(1, 2, 3).applyQuaternion(orientation(flipped));
    const expected = before.clone();
    for (const component of ['x', 'y', 'z'] as const) if (component !== axis) expected[component] *= -1;
    expect(after.distanceTo(expected)).toBeLessThan(1e-10);
    expect(flipped).toMatchObject({ ensureOnBed: true, autoOrient: false, scale: 1.7 });
  });
  it.each([[1,0,0], [0,1,0], [0,0,1], [-1,-2,3]])('places a chosen face downward after a tilt: %j', (x, y, z) => {
    const current = transformSchema.parse({ rotation: { x: 15, y: -28, z: 73 }, ensureOnBed: false, autoOrient: true });
    const localNormal = new Vector3(x, y, z).normalize();
    const worldNormal = localNormal.clone().applyQuaternion(orientation(current));
    const next = placeOnFace(current, worldNormal);
    const placedNormal = localNormal.applyQuaternion(orientation(next));
    expect(placedNormal.distanceTo(new Vector3(0, 0, -1))).toBeLessThan(1e-10);
    expect(next.ensureOnBed).toBe(true);
    expect(next.autoOrient).toBe(false);
  });
  it('keeps actual vertices on the bed after arbitrary rotation and scale of an irregular model', () => {
    const { mesh, center } = irregularMesh();
    try {
      const transform = transformSchema.parse({ rotation: { x: -31, y: 47, z: 21 }, scale: 1.6 });
      const bounds = positionMeshOnPlate(mesh, transform, volume, center);
      const vertices = mesh.geometry.getAttribute('position');
      let lowest = Infinity;
      for (let index = 0; index < vertices.count; index++) {
        const vertex = new Vector3().fromBufferAttribute(vertices, index).applyMatrix4(mesh.matrixWorld);
        lowest = Math.min(lowest, vertex.z);
      }
      expect(lowest).toBeCloseTo(0, 10);
      expect(bounds.min.z).toBeCloseTo(0, 10);
    } finally { mesh.geometry.dispose(); mesh.material.dispose(); }
  });
  it('snaps an elevated model back to the bed for every face flip', () => {
    const { mesh, center } = irregularMesh();
    try {
      for (const axis of ['x', 'y', 'z'] as const) {
        const flipped = turnOnAxis(transformSchema.parse({ ensureOnBed: false }), axis, 180);
        expect(positionMeshOnPlate(mesh, flipped, volume, center).min.z).toBeCloseTo(0, 10);
      }
    } finally { mesh.geometry.dispose(); mesh.material.dispose(); }
  });
});
