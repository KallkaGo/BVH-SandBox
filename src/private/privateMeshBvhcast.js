import { Box3, Matrix4 } from 'three';
import { BYTES_PER_NODE } from 'three-mesh-bvh/src/core/Constants.js';
import { BufferStack } from 'three-mesh-bvh/src/core/utils/BufferStack.js';
import {
  BOUNDING_DATA_INDEX,
  COUNT,
  IS_LEAF,
  LEFT_NODE,
  OFFSET,
  RIGHT_NODE,
} from 'three-mesh-bvh/src/core/utils/nodeBufferUtils.js';
import { arrayToBox } from 'three-mesh-bvh/src/utils/ArrayBoxUtilities.js';
import { ExtendedTrianglePool } from 'three-mesh-bvh/src/utils/ExtendedTrianglePool.js';
import { PrimitivePool } from 'three-mesh-bvh/src/utils/PrimitivePool.js';
import { setTriangle } from 'three-mesh-bvh/src/utils/TriangleUtilities.js';

const UINT32_PER_NODE = BYTES_PER_NODE / 4;

const _bufferStack1 = new BufferStack.constructor();
const _bufferStack2 = new BufferStack.constructor();
const _boxPool = new PrimitivePool(() => new Box3());
const _leftBox1 = new Box3();
const _rightBox1 = new Box3();
const _leftBox2 = new Box3();
const _rightBox2 = new Box3();

let _active = false;

function privateBvhcast(bvh, otherBvh, matrixToLocal, intersectsRanges) {
  if (_active) {
    throw new Error('MeshBVH: Recursive calls to bvhcast not supported.');
  }

  _active = true;

  const roots = bvh._roots;
  const otherRoots = otherBvh._roots;
  const invMat = new Matrix4().copy(matrixToLocal).invert();
  let result = false;
  let nodeOffset1 = 0;
  let nodeOffset2 = 0;

  try {
    for (let i = 0, il = roots.length; i < il; i++) {
      _bufferStack1.setBuffer(roots[i]);
      nodeOffset2 = 0;

      const localBox = _boxPool.getPrimitive();
      arrayToBox(BOUNDING_DATA_INDEX(0), _bufferStack1.float32Array, localBox);
      localBox.applyMatrix4(invMat);

      for (let j = 0, jl = otherRoots.length; j < jl; j++) {
        _bufferStack2.setBuffer(otherRoots[j]);

        result = _traverse(
          0,
          0,
          matrixToLocal,
          invMat,
          intersectsRanges,
          nodeOffset1,
          nodeOffset2,
          0,
          0,
          localBox
        );

        _bufferStack2.clearBuffer();
        nodeOffset2 += otherRoots[j].byteLength / BYTES_PER_NODE;

        if (result) {
          break;
        }
      }

      _boxPool.releasePrimitive(localBox);
      _bufferStack1.clearBuffer();
      nodeOffset1 += roots[i].byteLength / BYTES_PER_NODE;

      if (result) {
        break;
      }
    }

    return result;
  } finally {
    _active = false;
  }
}

function _traverse(
  node1Index32,
  node2Index32,
  matrix2to1,
  matrix1to2,
  intersectsRangesFunc,
  node1IndexOffset = 0,
  node2IndexOffset = 0,
  depth1 = 0,
  depth2 = 0,
  currBox = null,
  reversed = false
) {
  let bufferStack1;
  let bufferStack2;
  if (reversed) {
    bufferStack1 = _bufferStack2;
    bufferStack2 = _bufferStack1;
  } else {
    bufferStack1 = _bufferStack1;
    bufferStack2 = _bufferStack2;
  }

  const float32Array1 = bufferStack1.float32Array;
  const uint32Array1 = bufferStack1.uint32Array;
  const uint16Array1 = bufferStack1.uint16Array;
  const float32Array2 = bufferStack2.float32Array;
  const uint32Array2 = bufferStack2.uint32Array;
  const uint16Array2 = bufferStack2.uint16Array;

  const node1Index16 = node1Index32 * 2;
  const node2Index16 = node2Index32 * 2;
  const isLeaf1 = IS_LEAF(node1Index16, uint16Array1);
  const isLeaf2 = IS_LEAF(node2Index16, uint16Array2);

  let result = false;
  if (isLeaf1 && isLeaf2) {
    if (reversed) {
      result = intersectsRangesFunc(
        OFFSET(node2Index32, uint32Array2),
        COUNT(node2Index32 * 2, uint16Array2),
        OFFSET(node1Index32, uint32Array1),
        COUNT(node1Index32 * 2, uint16Array1),
        depth2,
        node2IndexOffset + node2Index32 / UINT32_PER_NODE,
        depth1,
        node1IndexOffset + node1Index32 / UINT32_PER_NODE
      );
    } else {
      result = intersectsRangesFunc(
        OFFSET(node1Index32, uint32Array1),
        COUNT(node1Index32 * 2, uint16Array1),
        OFFSET(node2Index32, uint32Array2),
        COUNT(node2Index32 * 2, uint16Array2),
        depth1,
        node1IndexOffset + node1Index32 / UINT32_PER_NODE,
        depth2,
        node2IndexOffset + node2Index32 / UINT32_PER_NODE
      );
    }
  } else if (isLeaf2) {
    const newBox = _boxPool.getPrimitive();
    arrayToBox(BOUNDING_DATA_INDEX(node2Index32), float32Array2, newBox);
    newBox.applyMatrix4(matrix2to1);

    const cl1 = LEFT_NODE(node1Index32);
    const cr1 = RIGHT_NODE(node1Index32, uint32Array1);
    arrayToBox(BOUNDING_DATA_INDEX(cl1), float32Array1, _leftBox1);
    arrayToBox(BOUNDING_DATA_INDEX(cr1), float32Array1, _rightBox1);

    const intersectCl1 = newBox.intersectsBox(_leftBox1);
    const intersectCr1 = newBox.intersectsBox(_rightBox1);

    result =
      (intersectCl1 &&
        _traverse(
          node2Index32,
          cl1,
          matrix1to2,
          matrix2to1,
          intersectsRangesFunc,
          node2IndexOffset,
          node1IndexOffset,
          depth2,
          depth1 + 1,
          newBox,
          !reversed
        )) ||
      (intersectCr1 &&
        _traverse(
          node2Index32,
          cr1,
          matrix1to2,
          matrix2to1,
          intersectsRangesFunc,
          node2IndexOffset,
          node1IndexOffset,
          depth2,
          depth1 + 1,
          newBox,
          !reversed
        ));

    _boxPool.releasePrimitive(newBox);
  } else {
    const cl2 = LEFT_NODE(node2Index32);
    const cr2 = RIGHT_NODE(node2Index32, uint32Array2);
    arrayToBox(BOUNDING_DATA_INDEX(cl2), float32Array2, _leftBox2);
    arrayToBox(BOUNDING_DATA_INDEX(cr2), float32Array2, _rightBox2);

    const leftIntersects = currBox.intersectsBox(_leftBox2);
    const rightIntersects = currBox.intersectsBox(_rightBox2);

    if (leftIntersects && rightIntersects) {
      result =
        _traverse(
          node1Index32,
          cl2,
          matrix2to1,
          matrix1to2,
          intersectsRangesFunc,
          node1IndexOffset,
          node2IndexOffset,
          depth1,
          depth2 + 1,
          currBox,
          reversed
        ) ||
        _traverse(
          node1Index32,
          cr2,
          matrix2to1,
          matrix1to2,
          intersectsRangesFunc,
          node1IndexOffset,
          node2IndexOffset,
          depth1,
          depth2 + 1,
          currBox,
          reversed
        );
    } else if (leftIntersects) {
      if (isLeaf1) {
        result = _traverse(
          node1Index32,
          cl2,
          matrix2to1,
          matrix1to2,
          intersectsRangesFunc,
          node1IndexOffset,
          node2IndexOffset,
          depth1,
          depth2 + 1,
          currBox,
          reversed
        );
      } else {
        const newBox = _boxPool.getPrimitive();
        newBox.copy(_leftBox2).applyMatrix4(matrix2to1);

        const cl1 = LEFT_NODE(node1Index32);
        const cr1 = RIGHT_NODE(node1Index32, uint32Array1);
        arrayToBox(BOUNDING_DATA_INDEX(cl1), float32Array1, _leftBox1);
        arrayToBox(BOUNDING_DATA_INDEX(cr1), float32Array1, _rightBox1);

        const intersectCl1 = newBox.intersectsBox(_leftBox1);
        const intersectCr1 = newBox.intersectsBox(_rightBox1);

        result =
          (intersectCl1 &&
            _traverse(
              cl2,
              cl1,
              matrix1to2,
              matrix2to1,
              intersectsRangesFunc,
              node2IndexOffset,
              node1IndexOffset,
              depth2,
              depth1 + 1,
              newBox,
              !reversed
            )) ||
          (intersectCr1 &&
            _traverse(
              cl2,
              cr1,
              matrix1to2,
              matrix2to1,
              intersectsRangesFunc,
              node2IndexOffset,
              node1IndexOffset,
              depth2,
              depth1 + 1,
              newBox,
              !reversed
            ));

        _boxPool.releasePrimitive(newBox);
      }
    } else if (rightIntersects) {
      if (isLeaf1) {
        result = _traverse(
          node1Index32,
          cr2,
          matrix2to1,
          matrix1to2,
          intersectsRangesFunc,
          node1IndexOffset,
          node2IndexOffset,
          depth1,
          depth2 + 1,
          currBox,
          reversed
        );
      } else {
        const newBox = _boxPool.getPrimitive();
        newBox.copy(_rightBox2).applyMatrix4(matrix2to1);

        const cl1 = LEFT_NODE(node1Index32);
        const cr1 = RIGHT_NODE(node1Index32, uint32Array1);
        arrayToBox(BOUNDING_DATA_INDEX(cl1), float32Array1, _leftBox1);
        arrayToBox(BOUNDING_DATA_INDEX(cr1), float32Array1, _rightBox1);

        const intersectCl1 = newBox.intersectsBox(_leftBox1);
        const intersectCr1 = newBox.intersectsBox(_rightBox1);

        result =
          (intersectCl1 &&
            _traverse(
              cr2,
              cl1,
              matrix1to2,
              matrix2to1,
              intersectsRangesFunc,
              node2IndexOffset,
              node1IndexOffset,
              depth2,
              depth1 + 1,
              newBox,
              !reversed
            )) ||
          (intersectCr1 &&
            _traverse(
              cr2,
              cr1,
              matrix1to2,
              matrix2to1,
              intersectsRangesFunc,
              node2IndexOffset,
              node1IndexOffset,
              depth2,
              depth1 + 1,
              newBox,
              !reversed
            ));

        _boxPool.releasePrimitive(newBox);
      }
    }
  }

  return result;
}

function resolveGeometryTriangleIndex(bvh, triangleIndex) {
  if (typeof bvh.resolveTriangleIndex === 'function') {
    return bvh.resolveTriangleIndex(triangleIndex);
  }

  return triangleIndex;
}

export function privateMeshBvhcast(meshBvh, otherBvh, matrixToLocal, callbacks = {}) {
  let { intersectsRanges, intersectsTriangles } = callbacks;

  if (intersectsTriangles) {
    const triangle1 = ExtendedTrianglePool.getPrimitive();
    const triangle2 = ExtendedTrianglePool.getPrimitive();
    const indexAttr1 = meshBvh.geometry.index;
    const positionAttr1 = meshBvh.geometry.attributes.position;
    const indexAttr2 = otherBvh.geometry.index;
    const positionAttr2 = otherBvh.geometry.attributes.position;

    const assignTriangle1 = (triangleIndex) => {
      const geometryTriangleIndex = resolveGeometryTriangleIndex(meshBvh, triangleIndex);
      setTriangle(triangle1, geometryTriangleIndex * 3, indexAttr1, positionAttr1);
      return geometryTriangleIndex;
    };

    const assignTriangle2 = (triangleIndex) => {
      const geometryTriangleIndex = resolveGeometryTriangleIndex(otherBvh, triangleIndex);
      setTriangle(triangle2, geometryTriangleIndex * 3, indexAttr2, positionAttr2);
      return geometryTriangleIndex;
    };

    const iterateOverDoubleTriangles = (
      offset1,
      count1,
      offset2,
      count2,
      depth1,
      nodeIndex1,
      depth2,
      nodeIndex2
    ) => {
      for (let i2 = offset2, l2 = offset2 + count2; i2 < l2; i2++) {
        const triangleIndex2 = assignTriangle2(i2);

        triangle2.a.applyMatrix4(matrixToLocal);
        triangle2.b.applyMatrix4(matrixToLocal);
        triangle2.c.applyMatrix4(matrixToLocal);
        triangle2.needsUpdate = true;

        for (let i1 = offset1, l1 = offset1 + count1; i1 < l1; i1++) {
          const triangleIndex1 = assignTriangle1(i1);
          triangle1.needsUpdate = true;

          if (
            intersectsTriangles(
              triangle1,
              triangle2,
              triangleIndex1,
              triangleIndex2,
              depth1,
              nodeIndex1,
              depth2,
              nodeIndex2
            )
          ) {
            return true;
          }
        }
      }

      return false;
    };

    if (intersectsRanges) {
      const originalIntersectsRanges = intersectsRanges;
      intersectsRanges = (
        offset1,
        count1,
        offset2,
        count2,
        depth1,
        nodeIndex1,
        depth2,
        nodeIndex2
      ) => {
        if (
          !originalIntersectsRanges(
            offset1,
            count1,
            offset2,
            count2,
            depth1,
            nodeIndex1,
            depth2,
            nodeIndex2
          )
        ) {
          return iterateOverDoubleTriangles(
            offset1,
            count1,
            offset2,
            count2,
            depth1,
            nodeIndex1,
            depth2,
            nodeIndex2
          );
        }

        return true;
      };
    } else {
      intersectsRanges = iterateOverDoubleTriangles;
    }

    try {
      return privateBvhcast(meshBvh, otherBvh, matrixToLocal, intersectsRanges);
    } finally {
      ExtendedTrianglePool.releasePrimitive(triangle1);
      ExtendedTrianglePool.releasePrimitive(triangle2);
    }
  }

  if (!intersectsRanges) {
    return false;
  }

  return privateBvhcast(meshBvh, otherBvh, matrixToLocal, intersectsRanges);
}
