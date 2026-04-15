import { MeshBVH, MeshBVHOptions } from 'three-mesh-bvh';

/**
 * 补充 three.js 模块声明增强
 *
 * three-mesh-bvh@0.7.6 已对 'three/src/core/BufferGeometry' 做了声明增强，
 * 此处针对 'three' 主入口做同样的增强，确保从 'three' 导入的 BufferGeometry
 * 也能识别 boundsTree / computeBoundsTree / disposeBoundsTree。
 */
declare module 'three' {
  interface BufferGeometry {
    boundsTree?: MeshBVH;
    computeBoundsTree(options?: MeshBVHOptions): MeshBVH;
    disposeBoundsTree(): void;
  }
}
