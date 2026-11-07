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
    this.isImage = false;
    this.imagePixels = null;
    this.axis = 'front';
    this.handArStream = null;
    this.handLandmarker = null;
    this.handLandmarkerLoading = null;
    this.handArRunning = false;
    this.handArFrame = 0;
    this.handArLastDetect = 0;
    this.handArLastSeen = 0;
    this.handArFlip = 1;
    this.handArRenderer = null;
    this.handArCamera = null;
    this.handArScene = null;
    this.handArAnchor = null;

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
    this.$('model-hand-ar').disabled = !ready;
    this.$('show-hand-ar').disabled = !ready;
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
    this.$('model-hand-ar').addEventListener('click', () => this.startHandAR());
    this.$('show-hand-ar').addEventListener('click', () => this.startHandAR());
    this.$('show-model-preview').addEventListener('click', () => this.showModelPreview());
    this.$('handar-flip').addEventListener('click', () => {
      this.handArFlip *= -1;
      this.$('handar-flip').classList.toggle('is-active', this.handArFlip < 0);
      if (this.handArAnchor?.children[0]) {
        this.handArAnchor.children[0].rotation.y = this.handArFlip < 0 ? Math.PI : 0;
      }
    });
    this.$('model-ar').addEventListener('click', async () => {
      if (!this.url) return;
      this.showModelPreview();
      this.setStatus('loading', 'Opening AR camera…');
      try {
        await this.viewer.activateAR();
        this.setStatus('ready', 'AR launched — place the design in your space');
      } catch {
        this.setStatus('warn', 'AR needs a compatible phone browser — open this Site on your phone and try again');
      }
    });
  }

  deactivate() {
    this.stopHandAR();
  }

  prepareForTest() {
    if (this.modelScene) return true;
    this.setStatus('error', 'Upload a Blender .glb before running its wind test');
    return false;
  }

  async loadFile(file) {
    const extension = file.name.split('.').pop()?.toLowerCase();
    const imageFile = ['png', 'jpg', 'jpeg', 'webp', 'svg'].includes(extension) || file.type.startsWith('image/');
    if (extension === 'blend') {
      this.setStatus('error', 'Export from Blender as glTF 2.0 (.glb), then drop that file here');
      return;
    }
    if (!imageFile && !['glb', 'gltf'].includes(extension)) {
      this.setStatus('error', 'Upload a Blender .glb or a PNG/JPG/WebP/SVG image');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      this.setStatus('error', 'Model is over 75 MB — reduce textures or geometry in Blender');
      return;
    }

    this.stopHandAR();
    this.showModelPreview();
    this.setReady(false);
    this.setStatus('loading', 'Reading mesh and preparing its wind silhouette…');
    this.$('model-name').textContent = file.name;
    this.$('model-meta').textContent = `${formatBytes(file.size)} · ${imageFile ? 'PALM IMAGE' : 'BLENDER GLTF'}`;

    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(file);
    this.isImage = imageFile;
    this.imagePixels = null;
    this.viewer.hidden = imageFile;
    this.$('model-image-preview').hidden = !imageFile;
    if (imageFile) {
      this.viewer.removeAttribute('src');
      this.$('model-image-preview').src = this.url;
    } else {
      this.$('model-image-preview').removeAttribute('src');
      this.viewer.src = this.url;
    }

    try {
      let stats;
      if (imageFile) {
        const texture = await new THREE.TextureLoader().loadAsync(this.url);
        texture.colorSpace = THREE.SRGBColorSpace;
        const width = texture.image.naturalWidth || texture.image.width || 1;
        const height = texture.image.naturalHeight || texture.image.height || 1;
        const aspect = width / height;
        const geometry = aspect >= 1
          ? new THREE.PlaneGeometry(2, 2 / aspect)
          : new THREE.PlaneGeometry(2 * aspect, 2);
        const material = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          alphaTest: 0.02,
          side: THREE.DoubleSide,
          toneMapped: false,
        });
        const source = new THREE.Group();
        source.add(new THREE.Mesh(geometry, material));
        this.modelScene = this.normaliseScene(source);
        this.imagePixels = this.readImagePixels(texture.image);
        stats = { triangles: 2, dimensions: `${width} × ${height} px` };
      } else {
        const gltf = await this.loader.loadAsync(this.url);
        stats = this.measure(gltf.scene);
        this.modelScene = this.normaliseScene(gltf.scene);
      }
      this.createHandArScene();
      this.$('model-tris').textContent = stats.triangles.toLocaleString('en-US');
      this.$('model-size').textContent = stats.dimensions;
      this.dropzone.classList.add('has-model');
      this.setReady(true);
      document.querySelectorAll('[data-model-axis]').forEach((button) => {
        button.disabled = imageFile && button.dataset.modelAxis !== 'front';
      });
      this.$('model-ar').disabled = imageFile;
      this.applyProjection('front');
      this.setStatus('ready', imageFile
        ? 'Image ready — choose Put it on my hand to use it as a live palm decal'
        : 'Model live — choose the wind direction or view it in AR');
    } catch (error) {
      console.error(error);
      this.modelScene = null;
      this.setStatus('error', imageFile
        ? 'Could not read this image. Try PNG, JPG, WebP, or SVG.'
        : extension === 'gltf'
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

  readImagePixels(image) {
    const canvas = document.createElement('canvas');
    canvas.width = PREVIEW_SIZE;
    canvas.height = PREVIEW_SIZE;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.clearRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
    const width = image.naturalWidth || image.width || 1;
    const height = image.naturalHeight || image.height || 1;
    const scale = Math.min(PREVIEW_SIZE / width, PREVIEW_SIZE / height);
    const drawWidth = width * scale;
    const drawHeight = height * scale;
    context.drawImage(image, (PREVIEW_SIZE - drawWidth) / 2, (PREVIEW_SIZE - drawHeight) / 2, drawWidth, drawHeight);
    return context.getImageData(0, 0, PREVIEW_SIZE, PREVIEW_SIZE).data;
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

  showModelPreview() {
    this.stopHandAR();
    this.$('model-preview').hidden = false;
    this.$('handar-view').hidden = true;
    this.$('show-model-preview').classList.add('is-active');
    this.$('show-hand-ar').classList.remove('is-active');
  }

  createHandArScene() {
    if (!this.modelScene) return;
    this.handArScene = new THREE.Scene();
    this.handArAnchor = new THREE.Group();
    const model = this.modelScene.children[0].clone(true);
    model.rotation.y = this.handArFlip < 0 ? Math.PI : 0;
    this.handArAnchor.add(model);
    this.handArAnchor.visible = false;
    this.handArScene.add(this.handArAnchor);
    this.handArScene.add(new THREE.HemisphereLight(0xffffff, 0x17312b, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(-2, 4, 5);
    this.handArScene.add(key);
  }

  async initHandLandmarker() {
    if (this.handLandmarker) return this.handLandmarker;
    if (this.handLandmarkerLoading) return this.handLandmarkerLoading;
    this.handLandmarkerLoading = (async () => {
      const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/wasm',
      );
      const options = {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 1,
        minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.55,
      };
      try {
        this.handLandmarker = await HandLandmarker.createFromOptions(vision, options);
      } catch {
        options.baseOptions.delegate = 'CPU';
        this.handLandmarker = await HandLandmarker.createFromOptions(vision, options);
      }
      return this.handLandmarker;
    })().finally(() => {
      this.handLandmarkerLoading = null;
    });
    return this.handLandmarkerLoading;
  }

  async startHandAR() {
    if (!this.modelScene) {
      this.setStatus('error', 'Upload a 3D object first, then choose Put it on my hand');
      return;
    }
    this.$('model-preview').hidden = true;
    this.$('handar-view').hidden = false;
    this.$('show-model-preview').classList.remove('is-active');
    this.$('show-hand-ar').classList.add('is-active');
    this.$('handar-status').dataset.state = 'loading';
    this.$('handar-status').textContent = 'Starting camera and loading MediaPipe…';
    if (this.handArRunning) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      });
      this.handArStream = stream;
      await this.initHandLandmarker();
      const video = this.$('handar-video');
      video.srcObject = stream;
      await video.play();
      if (!this.handArScene) this.createHandArScene();
      this.initHandArRenderer();
      this.handArRunning = true;
      this.handArLastDetect = 0;
      this.handArLastSeen = 0;
      this.$('handar-status').dataset.state = 'searching';
      this.$('handar-status').textContent = 'Show an open palm to place your object';
      this.handArFrame = requestAnimationFrame((now) => this.renderHandArFrame(now));
    } catch (error) {
      console.error(error);
      this.stopHandAR();
      this.$('handar-status').dataset.state = 'error';
      this.$('handar-status').textContent = error?.name === 'NotAllowedError'
        ? 'Allow camera access to use Hand AR'
        : 'Hand AR could not start — try the Camera hand mode instead';
    }
  }

  initHandArRenderer() {
    if (!this.handArRenderer) {
      this.handArRenderer = new THREE.WebGLRenderer({
        canvas: this.$('handar-canvas'),
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
      });
      this.handArRenderer.setClearColor(0x000000, 0);
      this.handArRenderer.outputColorSpace = THREE.SRGBColorSpace;
      this.handArCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 20);
      this.handArCamera.position.z = 5;
    }
    this.resizeHandArRenderer();
  }

  resizeHandArRenderer() {
    if (!this.handArRenderer) return;
    const view = this.$('handar-view');
    const width = Math.max(2, view.clientWidth);
    const height = Math.max(2, view.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const aspect = width / height;
    this.handArRenderer.setPixelRatio(dpr);
    this.handArRenderer.setSize(width, height, false);
    this.handArCamera.left = -aspect;
    this.handArCamera.right = aspect;
    this.handArCamera.top = 1;
    this.handArCamera.bottom = -1;
    this.handArCamera.updateProjectionMatrix();
  }

  updateHandAnchor(landmarks) {
    if (!landmarks?.length || !this.handArAnchor) return false;
    const indices = [0, 5, 9, 13, 17];
    const center = indices.reduce(
      (value, index) => ({ x: value.x + (1 - landmarks[index].x), y: value.y + landmarks[index].y }),
      { x: 0, y: 0 },
    );
    center.x /= indices.length;
    center.y /= indices.length;

    const width = this.$('handar-view').clientWidth;
    const height = this.$('handar-view').clientHeight;
    const aspect = width / Math.max(1, height);
    const indexMcp = landmarks[5];
    const pinkyMcp = landmarks[17];
    const palmWidth = Math.hypot(indexMcp.x - pinkyMcp.x, indexMcp.y - pinkyMcp.y);
    const wrist = landmarks[0];
    const middle = landmarks[9];
    const directionX = (1 - middle.x) - (1 - wrist.x);
    const directionY = (0.5 - middle.y) - (0.5 - wrist.y);
    const targetAngle = Math.atan2(directionY, directionX) - Math.PI / 2;
    const size = Number(this.$('handar-size').value) / 100;
    const targetScale = Math.max(0.08, palmWidth * aspect * 0.95 * size);
    const targetPosition = new THREE.Vector3(
      (center.x - 0.5) * 2 * aspect,
      (0.5 - center.y) * 2,
      0,
    );

    if (!this.handArAnchor.visible) {
      this.handArAnchor.position.copy(targetPosition);
      this.handArAnchor.scale.setScalar(targetScale);
      this.handArAnchor.rotation.z = targetAngle;
    } else {
      this.handArAnchor.position.lerp(targetPosition, 0.34);
      const scale = THREE.MathUtils.lerp(this.handArAnchor.scale.x, targetScale, 0.3);
      this.handArAnchor.scale.setScalar(scale);
      const angleDelta = Math.atan2(
        Math.sin(targetAngle - this.handArAnchor.rotation.z),
        Math.cos(targetAngle - this.handArAnchor.rotation.z),
      );
      this.handArAnchor.rotation.z += angleDelta * 0.32;
    }
    this.handArAnchor.visible = true;
    return true;
  }

  renderHandArFrame(now) {
    if (!this.handArRunning) return;
    this.handArFrame = requestAnimationFrame((next) => this.renderHandArFrame(next));
    this.resizeHandArRenderer();
    const video = this.$('handar-video');
    if (video.readyState >= 2 && now - this.handArLastDetect > 66) {
      this.handArLastDetect = now;
      try {
        const landmarks = this.handLandmarker.detectForVideo(video, now).landmarks?.[0];
        if (this.updateHandAnchor(landmarks)) {
          this.handArLastSeen = now;
          this.$('handar-view').classList.add('has-hand');
          this.$('handar-status').dataset.state = 'locked';
          this.$('handar-status').textContent = 'Hand locked · move, rotate, or resize the object';
        } else if (now - this.handArLastSeen > 280) {
          if (this.handArAnchor) this.handArAnchor.visible = false;
          this.$('handar-view').classList.remove('has-hand');
          this.$('handar-status').dataset.state = 'searching';
          this.$('handar-status').textContent = 'Show an open palm to place your object';
        }
      } catch (error) {
        console.error(error);
      }
    }
    this.handArRenderer.render(this.handArScene, this.handArCamera);
  }

  stopHandAR() {
    this.handArRunning = false;
    if (this.handArFrame) cancelAnimationFrame(this.handArFrame);
    this.handArFrame = 0;
    if (this.handArStream) this.handArStream.getTracks().forEach((track) => track.stop());
    this.handArStream = null;
    const video = this.$('handar-video');
    if (video) video.srcObject = null;
    if (this.handArAnchor) this.handArAnchor.visible = false;
    this.$('handar-view')?.classList.remove('has-hand');
  }

  applyProjection(axis = 'front') {
    if (!this.modelScene) return;
    if (this.isImage) axis = 'front';
    this.axis = axis;
    document.querySelectorAll('[data-model-axis]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.modelAxis === axis);
    });

    let pixels = this.imagePixels;
    if (!pixels) {
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
      pixels = context.getImageData(0, 0, PREVIEW_SIZE, PREVIEW_SIZE).data;
    }
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
