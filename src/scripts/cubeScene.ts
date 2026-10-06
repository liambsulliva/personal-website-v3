// Three.js half of the lobby cube (scripts/cube.ts). Only ever loaded through a
// dynamic import; named imports let Vite tree-shake three down to what's used.

import {
  BoxGeometry,
  EdgesGeometry,
  MathUtils,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

// Rotating silhouette (the body diagonal) as a share of the viewport.
const HEIGHT_SHARE = 0.85;
const WIDTH_SHARE = 0.5;
// Center sits a little left of the viewport's middle.
const OFFSET_X_SHARE = -0.09;
const LINE_WIDTH = 1.5;

export type CubeScene = {
  setColor: (css: string) => void;
  resize: () => void;
  frame: (dt: number) => void;
};

export function createScene(canvas: HTMLCanvasElement): CubeScene {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);

  const camera = new PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.z = 10;

  const geometry = new LineSegmentsGeometry().fromEdgesGeometry(
    new EdgesGeometry(new BoxGeometry(1, 1, 1)),
  );
  const material = new LineMaterial({ linewidth: LINE_WIDTH });
  const cube = new LineSegments2(geometry, material);
  cube.rotation.set(0.5, 0.6, 0);

  const world = new Scene();
  world.add(cube);

  const resize = () => {
    const width = innerWidth;
    const height = innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    material.resolution.set(width, height);

    // World units per CSS pixel at the cube's depth (z = 0).
    const unit = (2 * camera.position.z * Math.tan(MathUtils.degToRad(camera.fov / 2))) / height;
    const silhouette = Math.min(height * HEIGHT_SHARE, width * WIDTH_SHARE);
    cube.scale.setScalar((silhouette / Math.sqrt(3)) * unit);
    cube.position.x = width * OFFSET_X_SHARE * unit;
  };

  resize();

  return {
    setColor: (css) => material.color.setStyle(css),
    resize,
    frame: (dt) => {
      cube.rotation.x += 0.12 * dt;
      cube.rotation.y += 0.17 * dt;
      renderer.render(world, camera);
    },
  };
}
