import { Line3, Matrix4, Mesh, Vector3 } from 'three';
import type { MeshBVH } from 'three-mesh-bvh';
import { privateMeshBvhcast } from './private/privateMeshBvhcast.js';

export interface IntersectionSegment {
  start: Vector3;
  end: Vector3;
}

export interface TriangleVertexIndices {
  a: number;
  b: number;
  c: number;
}

export interface CollisionResult {
  hit: boolean;
  triangleCount: number;
  sourceTriangleIndices: TriangleVertexIndices[];
  targetTriangleIndices: TriangleVertexIndices[];
  segments: IntersectionSegment[];
  fromCache: boolean;
}

interface OrderedPair {
  cacheKey: string;
  meshA: Mesh;
  meshB: Mesh;
}

export class TransformFingerprint {
  px = 0;
  py = 0;
  pz = 0;
  sx = 1;
  sy = 1;
  sz = 1;

  updateFromMesh(mesh: Mesh): this {
    const pos = mesh.position;
    const scl = mesh.scale;
    this.px = pos.x;
    this.py = pos.y;
    this.pz = pos.z;
    this.sx = scl.x;
    this.sy = scl.y;
    this.sz = scl.z;
    return this;
  }

  equals(other: TransformFingerprint, epsilon = 1e-6): boolean {
    return (
      Math.abs(this.px - other.px) < epsilon &&
      Math.abs(this.py - other.py) < epsilon &&
      Math.abs(this.pz - other.pz) < epsilon &&
      Math.abs(this.sx - other.sx) < epsilon &&
      Math.abs(this.sy - other.sy) < epsilon &&
      Math.abs(this.sz - other.sz) < epsilon
    );
  }
}

export class CacheEntry {
  fingerprintA = new TransformFingerprint();
  fingerprintB = new TransformFingerprint();
  result: CollisionResult | null = null;
}

export class BVHCollisionDetector {
  private _cache = new Map<string, CacheEntry>();
  private _invMatA = new Matrix4();
  private _matB = new Matrix4();
  private _intersectionLine = new Line3();
  private _tempFP_A = new TransformFingerprint();
  private _tempFP_B = new TransformFingerprint();

  cacheHitCount = 0;

  detect(sourceMesh: Mesh, targetMesh: Mesh): CollisionResult {
    const { cacheKey, meshA, meshB } = this._makeOrderedPair(sourceMesh, targetMesh);

    this._tempFP_A.updateFromMesh(meshA);
    this._tempFP_B.updateFromMesh(meshB);

    const cached = this._cache.get(cacheKey);
    if (
      cached?.result &&
      cached.fingerprintA.equals(this._tempFP_A) &&
      cached.fingerprintB.equals(this._tempFP_B)
    ) {
      this.cacheHitCount++;
      return { ...cached.result, fromCache: true };
    }

    const result = this._performDetection(sourceMesh, targetMesh);
    this._updateCache(cacheKey, meshA, meshB, result);
    return result;
  }

  detectMultiple(sourceMesh: Mesh, targetMeshes: Mesh[]): Map<Mesh, CollisionResult> {
    const results = new Map<Mesh, CollisionResult>();
    for (const target of targetMeshes) {
      results.set(target, this.detect(sourceMesh, target));
    }

    return results;
  }

  invalidateCache(meshA: Mesh, meshB: Mesh): void {
    const { cacheKey } = this._makeOrderedPair(meshA, meshB);
    this._cache.delete(cacheKey);
  }

  clearCache(): void {
    this._cache.clear();
    this.cacheHitCount = 0;
  }

  get cacheSize(): number {
    return this._cache.size;
  }

  dispose(): void {
    this.clearCache();
  }

  private _makeOrderedPair(mesh1: Mesh, mesh2: Mesh): OrderedPair {
    if (mesh1.uuid <= mesh2.uuid) {
      return {
        cacheKey: `${mesh1.uuid}_${mesh2.uuid}`,
        meshA: mesh1,
        meshB: mesh2,
      };
    }

    return {
      cacheKey: `${mesh2.uuid}_${mesh1.uuid}`,
      meshA: mesh2,
      meshB: mesh1,
    };
  }

  private _performDetection(sourceMesh: Mesh, targetMesh: Mesh): CollisionResult {
    const sourceBVH: MeshBVH | undefined = sourceMesh.geometry.boundsTree;
    const targetBVH: MeshBVH | undefined = targetMesh.geometry.boundsTree;

    if (!sourceBVH || !targetBVH) {
      return this._createEmptyResult();
    }

    this._invMatA.copy(sourceMesh.matrixWorld).invert();
    this._matB.copy(this._invMatA).multiply(targetMesh.matrixWorld);

    const sourceTriangleIndices: TriangleVertexIndices[] = [];
    const targetTriangleIndices: TriangleVertexIndices[] = [];
    const segments: IntersectionSegment[] = [];

    privateMeshBvhcast(sourceBVH, targetBVH, this._matB, {
      intersectsTriangles: (triangle1, triangle2, triIndexA, triIndexB) => {
        if (!triangle1.intersectsTriangle(triangle2, this._intersectionLine)) {
          return false;
        }

        sourceTriangleIndices.push(this._getTriangleVertexIndices(sourceMesh, triIndexA));
        targetTriangleIndices.push(this._getTriangleVertexIndices(targetMesh, triIndexB));
        segments.push({
          start: this._intersectionLine.start.clone().applyMatrix4(sourceMesh.matrixWorld),
          end: this._intersectionLine.end.clone().applyMatrix4(sourceMesh.matrixWorld),
        });

        return false;
      },
    });

    const triangleCount = sourceTriangleIndices.length;
    return {
      hit: triangleCount > 0,
      triangleCount,
      sourceTriangleIndices,
      targetTriangleIndices,
      segments,
      fromCache: false,
    };
  }

  private _getTriangleVertexIndices(mesh: Mesh, triangleIndex: number): TriangleVertexIndices {
    const baseIndex = triangleIndex * 3;
    const index = mesh.geometry.index;

    if (index) {
      return {
        a: index.getX(baseIndex),
        b: index.getX(baseIndex + 1),
        c: index.getX(baseIndex + 2),
      };
    }

    return {
      a: baseIndex,
      b: baseIndex + 1,
      c: baseIndex + 2,
    };
  }

  private _updateCache(
    cacheKey: string,
    meshA: Mesh,
    meshB: Mesh,
    result: CollisionResult
  ): void {
    let entry = this._cache.get(cacheKey);
    if (!entry) {
      entry = new CacheEntry();
      this._cache.set(cacheKey, entry);
    }

    entry.fingerprintA.updateFromMesh(meshA);
    entry.fingerprintB.updateFromMesh(meshB);
    entry.result = {
      hit: result.hit,
      triangleCount: result.triangleCount,
      sourceTriangleIndices: result.sourceTriangleIndices.map((tri) => ({ ...tri })),
      targetTriangleIndices: result.targetTriangleIndices.map((tri) => ({ ...tri })),
      segments: result.segments.map((segment) => ({
        start: segment.start.clone(),
        end: segment.end.clone(),
      })),
      fromCache: false,
    };
  }

  private _createEmptyResult(): CollisionResult {
    return {
      hit: false,
      triangleCount: 0,
      sourceTriangleIndices: [],
      targetTriangleIndices: [],
      segments: [],
      fromCache: false,
    };
  }
}
