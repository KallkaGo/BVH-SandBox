import * as THREE from 'three';
import {
  BufferGeometry,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DragControls } from 'three/addons/controls/DragControls.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
} from 'three-mesh-bvh';
import { BVHCollisionDetector } from './BVHCollisionDetector';
import type { CollisionResult } from './BVHCollisionDetector';

// ─── 扩展 Three.js prototype ────────────────────────────────
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// ─── 类型定义 ───────────────────────────────────────────────

/** 目标体 userData 结构 */
interface TargetUserData {
  velocity: Vector3;
  isHit: boolean;
}

/** 碰撞检测结果条目（UI 展示用） */
interface DetectionEntry {
  mesh: Mesh;
  result: CollisionResult;
}

// ─── 场景初始化 ─────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.shadowMap.enabled = true;
document.getElementById('canvas-container')!.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);
scene.fog = new THREE.Fog(0x111111, 20, 60);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
camera.position.set(0, 8, 16);

const orbitControls = new OrbitControls(camera, renderer.domElement);
orbitControls.enableDamping = true;

// 灯光
scene.add(new THREE.AmbientLight(0xffffff, 0.4));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(5, 10, 5);
dirLight.castShadow = true;
scene.add(dirLight);

// 网格地板
scene.add(new THREE.GridHelper(30, 30, 0x333333, 0x222222));

// ─── 碰撞检测器实例 ─────────────────────────────────────────
const detector = new BVHCollisionDetector();
const collisionSegmentsGroup = new THREE.Group();
const collisionSegmentMaterial = new LineMaterial({
  color: 0xffcc33,
  transparent: true,
  opacity: 0.95,
  linewidth: 4,
  worldUnits: false,
  depthTest:false,
  depthWrite:false
});
scene.add(collisionSegmentsGroup);

// ─── 主检测体（蓝色球体） ───────────────────────────────────
const sourceGeo = new THREE.SphereGeometry(1.5, 32, 32);
sourceGeo.computeBoundsTree();

const sourceMat = new THREE.MeshStandardMaterial({
  color: 0x44aaff,
  transparent: true,
  opacity: 0.85,
  emissive: 0x112244,
});
const sourceMesh = new THREE.Mesh(sourceGeo, sourceMat);
sourceMesh.castShadow = true;
scene.add(sourceMesh);

// ─── DragControls ───────────────────────────────────────────
const dragControls = new DragControls([sourceMesh], camera, renderer.domElement);
dragControls.addEventListener('dragstart', () => {
  orbitControls.enabled = false;
});
dragControls.addEventListener('dragend', () => {
  orbitControls.enabled = true;
});
dragControls.addEventListener('drag', () => {
  sourceMesh.updateMatrixWorld();
  runCollisionDetection();
});

// ─── 目标体集合 ─────────────────────────────────────────────
const targets: Mesh[] = [];

const GEO_FACTORIES: (() => BufferGeometry)[] = [
  () => new THREE.BoxGeometry(1.2, 1.2, 1.2, 4, 4, 4),
  () => new THREE.SphereGeometry(0.7, 16, 16),
  () => new THREE.ConeGeometry(0.7, 1.4, 16),
  () => new THREE.TorusGeometry(0.6, 0.25, 12, 24),
  () => new THREE.OctahedronGeometry(0.9),
];

function createTarget(position: Vector3): Mesh {
  const geo = GEO_FACTORIES[Math.floor(Math.random() * GEO_FACTORIES.length)]();
  geo.computeBoundsTree();

  const mat = new THREE.MeshStandardMaterial({
    color: 0x88ff88,
    transparent: true,
    opacity: 0.8,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(position);
  mesh.castShadow = true;

  const userData: TargetUserData = {
    velocity: new THREE.Vector3(
      (Math.random() - 0.5) * 0.04,
      (Math.random() - 0.5) * 0.02,
      (Math.random() - 0.5) * 0.04
    ),
    isHit: false,
  };
  mesh.userData = userData;

  scene.add(mesh);
  targets.push(mesh);
  return mesh;
}

/** 类型安全地获取 target mesh 的 userData */
function getTargetData(mesh: Mesh): TargetUserData {
  return mesh.userData as TargetUserData;
}

/** 类型安全地获取 mesh 的 MeshStandardMaterial */
function getStdMaterial(mesh: Mesh): MeshStandardMaterial {
  return mesh.material as MeshStandardMaterial;
}

function clearCollisionSegments(): void {
  while (collisionSegmentsGroup.children.length > 0) {
    const child = collisionSegmentsGroup.children.pop()!;
    collisionSegmentsGroup.remove(child);

    if ('geometry' in child && child.geometry) {
      (child.geometry as LineSegmentsGeometry).dispose();
    }
  }
}

function updateCollisionSegments(results: DetectionEntry[]): void {
  clearCollisionSegments();

  const positions: number[] = [];
  for (const { result } of results) {
    for (const segment of result.segments) {
      positions.push(
        segment.start.x,
        segment.start.y,
        segment.start.z,
        segment.end.x,
        segment.end.y,
        segment.end.z
      );
    }
  }

  if (positions.length === 0) {
    return;
  }

  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);

  const lineSegments = new LineSegments2(geometry, collisionSegmentMaterial);
  lineSegments.computeLineDistances();
  collisionSegmentsGroup.add(lineSegments);
}

// 初始添加 6 个目标
for (let i = 0; i < 6; i++) {
  createTarget(
    new THREE.Vector3(
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 4,
      (Math.random() - 0.5) * 10
    )
  );
}

// ─── UI 更新 ────────────────────────────────────────────────
function updateUI(results: DetectionEntry[]): void {
  document.getElementById('obj-count')!.textContent = String(targets.length);

  let hitCount = 0;
  const lines: string[] = [];

  results.forEach(({ mesh, result }, i) => {
    if (result.hit) hitCount++;

    const name =
      mesh.geometry.type.replace('BufferGeometry', '').replace('Geometry', '') || 'Mesh';
    const cacheTag = result.fromCache ? ' <span class="cache-hit">[cached]</span>' : '';

    lines.push(
      `<div style="margin-top:6px;border-top:1px solid #333;padding-top:4px;">` +
        `<span class="${result.hit ? 'hit' : 'nohit'}">[${i}] ${name}</span>${cacheTag} ` +
        `${result.hit ? '碰撞' : '无碰撞'}` +
        `</div>`
    );
  });

  document.getElementById('hit-count')!.textContent = String(hitCount);
  document.getElementById('cache-count')!.textContent = String(detector.cacheHitCount);
  document.getElementById('detail-list')!.innerHTML = lines.join('');
}

// ─── 碰撞检测执行 ───────────────────────────────────────────
function runCollisionDetection(): void {
  const results: DetectionEntry[] = [];

  for (const mesh of targets) {
    const result = detector.detect(sourceMesh, mesh);

    getTargetData(mesh).isHit = result.hit;
    const mat = getStdMaterial(mesh);
    mat.color.set(result.hit ? 0xff4444 : 0x88ff88);
    mat.emissive.set(result.hit ? 0x441111 : 0x000000);

    results.push({ mesh, result });
  }

  updateCollisionSegments(results);
  updateUI(results);
}

// ─── 动画循环 ───────────────────────────────────────────────
let paused = false;

function animate(): void {
  requestAnimationFrame(animate);
  orbitControls.update();

  if (!paused) {
    for (const mesh of targets) {
      const data = getTargetData(mesh);
      mesh.position.add(data.velocity);
      mesh.rotation.x += 0.01;
      mesh.rotation.y += 0.007;

      for (const axis of ['x', 'y', 'z'] as const) {
        const bound = axis === 'y' ? 4 : 7;
        if (Math.abs(mesh.position[axis]) > bound) {
          data.velocity[axis] *= -1;
        }
      }

      mesh.updateMatrixWorld();
    }

    sourceMesh.updateMatrixWorld();
    runCollisionDetection();
  }

  renderer.render(scene, camera);
}

// ─── 响应式 ─────────────────────────────────────────────────
function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  collisionSegmentMaterial.resolution.set(w, h);
}
window.addEventListener('resize', resize);
resize();

// ─── 按钮事件 ───────────────────────────────────────────────
document.getElementById('btn-add')!.addEventListener('click', () => {
  createTarget(
    new THREE.Vector3(
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 4,
      (Math.random() - 0.5) * 10
    )
  );
});

document.getElementById('btn-toggle')!.addEventListener('click', () => {
  paused = !paused;
});

document.getElementById('btn-reset')!.addEventListener('click', () => {
  for (const m of targets) {
    scene.remove(m);
    m.geometry.disposeBoundsTree();
    m.geometry.dispose();
  }
  targets.length = 0;

  detector.clearCache();

  for (let i = 0; i < 6; i++) {
    createTarget(
      new THREE.Vector3(
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 4,
        (Math.random() - 0.5) * 10
      )
    );
  }
});

// 启动
animate();
