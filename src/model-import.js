import '@google/model-viewer';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const PREVIEW_SIZE = 512;
const MAX_FILE_BYTES = 75 * 1024 * 1024;

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export class ModelImporter {
  constructor({ mask, onMask, onFlowReset }) {
    this.mask = mask;
    this.onMask = onMask;
    this.onFlowReset = onFlowReset;
    this.$ = (id) => document.getElementById(id);
    this.viewer = this.$('model-viewer');
    this.dropzone = this.$('model-dropzone');
    this.input = this.$('model-file');
    this.url = null;
    this.modelScene = null;
    this.axis = 'front';

    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(PREVIEW_SIZE, PREVIEW_SIZE, false);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.OrthographicCamera(-1.25, 1.25, 1.25, -1.25, 0.01, 20);
    this.silhouetteMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
    });
    this.loader = new GLTFLoader();
    this.bindEvents();
  }

  setStatus(state, message) {
    const el = this.$('model-status');
    el.dataset.state = state;
    el.querySelector('span').textContent = message;
  }

  setReady(ready) {
    document.querySelectorAll('[data-model-axis]').forEach((button) => {
      button.disabled = !ready;
    });
    this.$('model-ar').disabled = !ready;
  }

  bindEvents() {
    this.setReady(false);
    this.$('model-browse').disabled = false;
    this.$('model-browse').addEventListener('click', () => this.input.click());
    this.input.addEventListener('change', () => {
      const [file] = this.input.files;
      if (file) this.loadFile(file);
    });

    for (const eventName of ['dragenter', 'dragover']) {
      this.dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        this.dropzone.classList.add('is-dragging');
      });
    }
    for (const eventName of ['dragleave', 'drop']) {
      this.dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        this.dropzone.classList.remove('is-dragging');
      });
    }
    this.dropzone.addEventListener('drop', (event) => {
      const [file] = event.dataTransfer.files;
      if (file) this.loadFile(file);
    });

    document.querySelectorAll('[data-model-axis]').forEach((button) => {
      button.addEventListener('click', () => this.applyProjection(button.dataset.modelAxis));
    });
    this.$('model-ar').addEventListener('click', async () => {
      if (!this.url) return;
      this.setStatus('loading', 'Opening AR camera…');
      try {
        await this.viewer.activateAR();
        this.setStatus('ready', 'AR launched — place the design in your space');
      } catch {
        this.setStatus('warn', 'AR needs a compatible phone browser — open this Site on your phone and try again');
      }
    });
  }

  prepareForTest() {
    if (this.modelScene) return true;
    this.setStatus('error', 'Upload a Blender .glb before running its wind test');
    return false;
  }

  async loadFile(file) {
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (extension === 'blend') {
      this.setStatus('error', 'Export from Blender as glTF 2.0 (.glb), then drop that file here');
      return;
    }
    if (!['glb', 'gltf'].includes(extension)) {
      this.setStatus('error', 'Use a Blender glTF export: .glb is recommended');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      this.setStatus('error', 'Model is over 75 MB — reduce textures or geometry in Blender');
      return;
    }

    this.setReady(false);
    this.setStatus('loading', 'Reading mesh and preparing its wind silhouette…');
    this.$('model-name').textContent = file.name;
    this.$('model-meta').textContent = `${formatBytes(file.size)} · BLENDER GLTF`;

    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(file);
    this.viewer.src = this.url;

    try {
      const gltf = await this.loader.loadAsync(this.url);
      const stats = this.measure(gltf.scene);
      this.modelScene = this.normaliseScene(gltf.scene);
      this.$('model-tris').textContent = stats.triangles.toLocaleString('en-US');
      this.$('model-size').textContent = stats.dimensions;
      this.dropzone.classList.add('has-model');
      this.setReady(true);
      this.applyProjection('front');
      this.setStatus('ready', 'Model live — choose the wind direction or view it in AR');
    } catch (error) {
      console.error(error);
      this.modelScene = null;
      this.setStatus('error', extension === 'gltf'
        ? 'This .gltf references separate files. Export one self-contained .glb from Blender.'
        : 'Could not read this model. Re-export it as Blender glTF 2.0 (.glb).');
    }
  }

  measure(scene) {
    let triangles = 0;
    scene.traverse((node) => {
      if (!node.isMesh || !node.geometry) return;
      const geometry = node.geometry;
      triangles += geometry.index
        ? geometry.index.count / 3
        : (geometry.attributes.position?.count || 0) / 3;
    });
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const dimensions = `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)}`;
    return { triangles: Math.round(triangles), dimensions };
  }

  normaliseScene(source) {
    source.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(source);
    if (box.isEmpty()) throw new Error('Model contains no visible mesh');
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(longest) || longest <= 0) throw new Error('Model has invalid dimensions');

    const root = new THREE.Group();
    source.position.sub(center);
    root.add(source);
    root.scale.setScalar(2 / longest);
    const scene = new THREE.Scene();
    scene.add(root);
    scene.overrideMaterial = this.silhouetteMaterial;
    return scene;
  }

  applyProjection(axis = 'front') {
    if (!this.modelScene) return;
    this.axis = axis;
    document.querySelectorAll('[data-model-axis]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.modelAxis === axis);
    });

    this.camera.up.set(0, 1, 0);
    if (axis === 'side') this.camera.position.set(4, 0, 0);
    else if (axis === 'top') {
      this.camera.position.set(0, 4, 0);
      this.camera.up.set(0, 0, -1);
    } else this.camera.position.set(0, 0, 4);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.modelScene, this.camera);

    const preview = document.createElement('canvas');
    preview.width = PREVIEW_SIZE;
    preview.height = PREVIEW_SIZE;
    const context = preview.getContext('2d', { willReadFrequently: true });
    context.drawImage(this.renderer.domElement, 0, 0);
    const pixels = context.getImageData(0, 0, PREVIEW_SIZE, PREVIEW_SIZE).data;
    const binary = this.toTunnelMask(pixels);
    this.mask.setFromBinary(binary);
    this.onMask?.();
    this.onFlowReset?.();
    this.setStatus('ready', `${axis.toUpperCase()} projection sent to the wind tunnel`);
  }

  toTunnelMask(pixels) {
    let minX = PREVIEW_SIZE;
    let minY = PREVIEW_SIZE;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < PREVIEW_SIZE; y += 1) {
      for (let x = 0; x < PREVIEW_SIZE; x += 1) {
        const alpha = pixels[(x + y * PREVIEW_SIZE) * 4 + 3];
        if (alpha < 24) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    const W = this.mask.width;
    const H = this.mask.height;
    const out = new Uint8Array(W * H);
    if (maxX < minX || maxY < minY) return out;
    const sourceW = maxX - minX + 1;
    const sourceH = maxY - minY + 1;
    const scale = Math.min((H * 0.31) / sourceH, (W * 0.25) / sourceW);
    const targetW = Math.max(3, Math.round(sourceW * scale));
    const targetH = Math.max(3, Math.round(sourceH * scale));
    const left = Math.max(10, Math.round(W * 0.28 - targetW / 2));
    const top = Math.max(10, Math.round(H * 0.5 - targetH / 2));

    for (let y = 0; y < targetH; y += 1) {
      for (let x = 0; x < targetW; x += 1) {
        const sourceX = minX + Math.min(sourceW - 1, Math.floor((x / targetW) * sourceW));
        const sourceY = minY + Math.min(sourceH - 1, Math.floor((y / targetH) * sourceH));
        if (pixels[(sourceX + sourceY * PREVIEW_SIZE) * 4 + 3] >= 24) {
          out[left + x + (top + y) * W] = 1;
        }
      }
    }
    return out;
  }
}
