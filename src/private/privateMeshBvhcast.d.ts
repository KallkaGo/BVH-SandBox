import type { Matrix4 } from 'three';
import type { ExtendedTriangle, MeshBVH } from 'three-mesh-bvh';

export interface PrivateMeshBvhcastCallbacks {
  intersectsRanges?: (
    offset1: number,
    count1: number,
    offset2: number,
    count2: number,
    depth1: number,
    nodeIndex1: number,
    depth2: number,
    nodeIndex2: number
  ) => boolean;
  intersectsTriangles?: (
    triangle1: ExtendedTriangle,
    triangle2: ExtendedTriangle,
    triangleIndex1: number,
    triangleIndex2: number,
    depth1: number,
    nodeIndex1: number,
    depth2: number,
    nodeIndex2: number
  ) => boolean;
}

export declare function privateMeshBvhcast(
  meshBvh: MeshBVH,
  otherBvh: MeshBVH,
  matrixToLocal: Matrix4,
  callbacks?: PrivateMeshBvhcastCallbacks
): boolean;
