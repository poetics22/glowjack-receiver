/**
 * PetPulse — Chromecast Custom Receiver
 *
 * Receives AudioFeatures + pet image from the Android sender app via Cast
 * messaging, then renders music-reactive visualizations on the TV.
 *
 * Protocol:
 *   Namespace: urn:x-cast:com.petpulse.viz
 *   Messages (JSON):
 *     { type: "features", data: { energyLow, energyMid, energyHigh, ... } }
 *     { type: "vizIndex", index: 0 }
 *     { type: "petImage", dataUrl: "data:image/png;base64,..." }
 *     { type: "palette", colors: ["#FFAB40", "#FF6E40", ...] }
 *     { type: "ping" }  →  { type: "pong" }
 *
 * Visualizers:
 *   0: Nebula Swarm (particles)
 *   1: Bass Tunnel (expanding waveform rings)
 *   2: Ribbon Flow (flowing ribbons)
 *   3: Pulse Grid (grid of pulsing dots)
 *   4: Pet Glow (pet silhouette with music-reactive glow — requires petImage)
 */

const NAMESPACE = 'urn:x-cast:com.petpulse.viz';

// ===== State =====
let canvas, ctx, petCanvas, petCtx;
let width = 1920, height = 1080;
let activeVizIndex = 0;
let features = {
  energyLow: 0, energyMid: 0, energyHigh: 0,
  beatPulse: 0, isBeat: false, beatCount: 0, beatPhase: 0, tempoBpm: 120,
  brightness: 0.5, roughness: 0,
  sectionEnergy: 0,
  amplitude: 0,
  waveform: new Float32Array(128),
  fftMagnitudes: new Float32Array(64)
};
let connected = false;
let lastFeatureTime = 0;
let time = 0;

// Pet image state
let petImage = null;
let petLoaded = false;
let paletteColors = ['#FFAB40', '#FF6E40', '#FF4081', '#00E5FF', '#76FF03', '#E040FB'];

// ===== Cast Receiver Setup =====
function initCastReceiver() {
  const context = cast.framework.CastReceiverContext.getInstance();
  const options = new cast.framework.CastReceiverOptions();
  options.disableIdleTimeout = true;

  context.addCustomMessageListener(NAMESPACE, (event) => {
    handleMessage(event.data);
  });

  context.addEventListener(
    cast.framework.system.EventType.SENDER_CONNECTED, () => {
      console.log('[PetPulse] Sender connected');
      connected = true;
      document.getElementById('status').classList.add('hidden');
    }
  );

  context.addEventListener(
    cast.framework.system.EventType.SENDER_DISCONNECTED, () => {
      console.log('[PetPulse] Sender disconnected');
      connected = false;
      document.getElementById('status').classList.remove('hidden');

      setTimeout(() => {
        if (!connected) context.stop();
      }, 30000);
    }
  );

  context.start(options);
  console.log('[PetPulse] Receiver started, waiting for sender...');
}

function handleMessage(data) {
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch (e) { return; }
  }

  switch (data.type) {
    case 'features':
      updateFeatures(data.data);
      lastFeatureTime = performance.now();
      break;
    case 'vizIndex':
      activeVizIndex = data.index || 0;
      console.log('[PetPulse] Viz index:', activeVizIndex);
      break;
    case 'petImage':
      loadPetImage(data.dataUrl);
      break;
    case 'palette':
      if (data.colors && data.colors.length > 0) {
        paletteColors = data.colors;
        console.log('[PetPulse] Palette updated:', paletteColors.length, 'colors');
      }
      break;
    case 'ping':
      const castCtx = cast.framework.CastReceiverContext.getInstance();
      castCtx.sendCustomMessage(NAMESPACE, undefined, { type: 'pong' });
      break;
  }
}

function loadPetImage(dataUrl) {
  if (!dataUrl) return;
  const img = new Image();
  img.onload = () => {
    petImage = img;
    petLoaded = true;
    console.log('[PetPulse] Pet image loaded:', img.width, 'x', img.height);
  };
  img.onerror = () => {
    console.warn('[PetPulse] Failed to load pet image');
  };
  img.src = dataUrl;
}

function updateFeatures(f) {
  if (!f) return;
  features.energyLow = f.energyLow || 0;
  features.energyMid = f.energyMid || 0;
  features.energyHigh = f.energyHigh || 0;
  features.beatPulse = f.beatPulse || 0;
  features.isBeat = f.isBeat || false;
  features.beatCount = f.beatCount || 0;
  features.beatPhase = f.beatPhase || 0;
  features.tempoBpm = f.tempoBpm || 120;
  features.brightness = f.brightness || 0.5;
  features.roughness = f.roughness || 0;
  features.sectionEnergy = f.sectionEnergy || 0;
  features.amplitude = f.amplitude || 0;
  if (f.waveform) features.waveform = new Float32Array(f.waveform);
  if (f.fftMagnitudes) features.fftMagnitudes = new Float32Array(f.fftMagnitudes);
}

// ===== Canvas Setup =====
function initCanvas() {
  canvas = document.getElementById('viz');
  ctx = canvas.getContext('2d');
  petCanvas = document.getElementById('pet-canvas');
  petCtx = petCanvas.getContext('2d');
  resize();
  window.addEventListener('resize', resize);
}

function resize() {
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = width;
  canvas.height = height;
  petCanvas.width = width;
  petCanvas.height = height;
}

// ===== Palette Helper =====
function palColor(index, alpha) {
  const hex = paletteColors[index % paletteColors.length];
  if (alpha === undefined) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${Math.min(alpha, 1)})`;
}

// ===== Nebula Swarm Visualizer =====
const nebulaParticles = [];
const NEBULA_COUNT = 200;

function initNebula() {
  for (let i = 0; i < NEBULA_COUNT; i++) {
    nebulaParticles.push({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 2,
      vy: (Math.random() - 0.5) * 2,
      size: 2 + Math.random() * 4,
      colorIdx: Math.floor(Math.random() * 6),
      life: Math.random()
    });
  }
}

function drawNebula() {
  const { energyLow, energyHigh, beatPulse, amplitude } = features;
  const cx = width / 2, cy = height / 2;

  for (const p of nebulaParticles) {
    const dx = cx - p.x, dy = cy - p.y;
    const dist = Math.sqrt(dx * dx + dy * dy) + 1;
    const attract = 0.5 + energyLow * 3;
    p.vx += (dx / dist) * attract * 0.01;
    p.vy += (dy / dist) * attract * 0.01;

    if (features.isBeat) {
      const repel = 3 + beatPulse * 8;
      p.vx -= (dx / dist) * repel;
      p.vy -= (dy / dist) * repel;
    }

    p.vx += (-dy / dist) * 0.3;
    p.vy += (dx / dist) * 0.3;
    p.vx *= 0.97;
    p.vy *= 0.97;
    p.x += p.vx;
    p.y += p.vy;

    if (p.x < 0) p.x += width;
    if (p.x > width) p.x -= width;
    if (p.y < 0) p.y += height;
    if (p.y > height) p.y -= height;

    p.colorIdx = (p.colorIdx + 0.01) % paletteColors.length;
    const alpha = 0.3 + amplitude * 0.5 + beatPulse * 0.2;
    const size = p.size * (1 + beatPulse * 2);

    ctx.beginPath();
    ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
    ctx.fillStyle = palColor(Math.floor(p.colorIdx), alpha);
    ctx.fill();

    if (size > 3) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, size * 2.5, 0, Math.PI * 2);
      ctx.fillStyle = palColor(Math.floor(p.colorIdx), alpha * 0.1);
      ctx.fill();
    }
  }
}

// ===== Bass Tunnel Visualizer =====
const tunnelRings = [];
const MAX_RINGS = 30;

function drawBassTunnel() {
  const { energyLow, beatPulse, isBeat, waveform } = features;
  const cx = width / 2, cy = height / 2;
  const maxR = Math.min(width, height) * 0.45;

  const spawnRate = 0.3 + energyLow * 4;
  if (Math.random() < spawnRate * 0.016 || isBeat) {
    if (tunnelRings.length < MAX_RINGS) {
      tunnelRings.push({
        radius: isBeat ? 8 : 3,
        thickness: isBeat ? 4 + beatPulse * 8 : 2 + energyLow * 4,
        alpha: 1,
        colorIdx: Math.floor(Math.random() * paletteColors.length),
        waveOff: Math.random(),
        waveAmp: 0.3 + features.amplitude * 1.5
      });
    }
  }

  const speed = 80 + energyLow * 300;

  for (let i = tunnelRings.length - 1; i >= 0; i--) {
    const ring = tunnelRings[i];
    ring.radius += speed * 0.016;
    ring.alpha = Math.max(0, 1 - ring.radius / maxR);

    if (ring.radius > maxR || ring.alpha < 0.02) {
      tunnelRings.splice(i, 1);
      continue;
    }

    const thickness = ring.thickness * (1 + beatPulse * 2);
    const pts = 72;

    ctx.beginPath();
    for (let p = 0; p <= pts; p++) {
      const angle = (p / pts) * Math.PI * 2;
      let waveDisp = 0;
      if (waveform.length > 0) {
        const wIdx = Math.floor(((p / pts) + ring.waveOff) * waveform.length) % waveform.length;
        waveDisp = waveform[Math.abs(wIdx)] * ring.waveAmp * ring.radius * 0.15;
      }
      const r = ring.radius + waveDisp;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (p === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = palColor(ring.colorIdx, ring.alpha * 0.8);
    ctx.lineWidth = thickness;
    ctx.stroke();
  }

  const glowA = Math.min(0.6, energyLow * 0.4 + beatPulse * 0.3);
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 40 + energyLow * 60);
  grad.addColorStop(0, palColor(0, glowA));
  grad.addColorStop(1, 'transparent');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
}

// ===== Ribbon Flow Visualizer =====
function drawRibbonFlow() {
  const { energyLow, energyMid, energyHigh, beatPulse, waveform } = features;
  const ribbonCount = 6;

  for (let r = 0; r < ribbonCount; r++) {
    const baseY = height * (0.15 + r * 0.12);
    const alpha = 0.3 + energyMid * 0.4 + beatPulse * 0.2;

    ctx.beginPath();
    for (let x = 0; x <= width; x += 4) {
      const t = x / width;
      let waveVal = 0;
      if (waveform.length > 0) {
        const wIdx = Math.floor((t + r * 0.1 + time * 0.05) * waveform.length) % waveform.length;
        waveVal = waveform[Math.abs(wIdx)];
      }
      const displacement = waveVal * 80 * (1 + energyLow * 2)
        + Math.sin(t * 6 + time * 2 + r) * 20 * (1 + energyHigh);
      const y = baseY + displacement;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = palColor(r, Math.min(alpha, 0.8));
    ctx.lineWidth = 2 + energyLow * 3 + beatPulse * 4;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
}

// ===== Pulse Grid Visualizer =====
function drawPulseGrid() {
  const { fftMagnitudes, beatPulse } = features;
  const cols = 16, rows = 10;
  const cellW = width / cols, cellH = height / rows;

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const cx = cellW * (gx + 0.5);
      const cy = cellH * (gy + 0.5);

      const fftIdx = Math.floor((gx / cols) * fftMagnitudes.length);
      const energy = fftMagnitudes[fftIdx] || 0;

      const radius = 3 + energy * cellW * 0.4 + beatPulse * 5;
      const colorIdx = (gx + gy) % paletteColors.length;
      const alpha = 0.2 + energy * 0.6 + beatPulse * 0.2;

      ctx.beginPath();
      ctx.arc(cx, cy, radius * 2, 0, Math.PI * 2);
      ctx.fillStyle = palColor(colorIdx, alpha * 0.15);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = palColor(colorIdx, Math.min(alpha, 0.9));
      ctx.fill();
    }
  }
}

// ===== Pet Glow Visualizer =====
function drawPetGlow() {
  if (!petLoaded || !petImage) {
    drawNebula();
    return;
  }

  const { energyLow, beatPulse, isBeat, amplitude } = features;
  const cx = width / 2, cy = height / 2;

  // Scale pet to fit TV
  const maxPetW = width * 0.5;
  const maxPetH = height * 0.7;
  const scale = Math.min(maxPetW / petImage.width, maxPetH / petImage.height);
  const pw = petImage.width * scale;
  const ph = petImage.height * scale;

  // Beat bounce
  const bounce = isBeat ? beatPulse * 15 : 0;
  const scaleP = 1 + beatPulse * 0.05;

  // Draw on pet canvas layer
  petCtx.clearRect(0, 0, width, height);

  // Glow layers behind pet
  for (let g = 3; g >= 1; g--) {
    const glowR = pw * 0.3 * g + energyLow * 80;
    const glowAlpha = (0.08 + beatPulse * 0.06) / g;
    const grad = petCtx.createRadialGradient(cx, cy - bounce, pw * 0.1, cx, cy - bounce, glowR);
    grad.addColorStop(0, palColor(g - 1, glowAlpha));
    grad.addColorStop(1, 'transparent');
    petCtx.fillStyle = grad;
    petCtx.fillRect(0, 0, width, height);
  }

  // Draw pet with beat scale + bounce
  petCtx.save();
  petCtx.translate(cx, cy - bounce);
  petCtx.scale(scaleP, scaleP);
  petCtx.globalAlpha = 0.85 + amplitude * 0.15;
  petCtx.drawImage(petImage, -pw / 2, -ph / 2, pw, ph);
  petCtx.restore();

  // Frequency bars at bottom
  const barCount = 48;
  const barW = width / barCount;
  for (let i = 0; i < barCount; i++) {
    const fftIdx = Math.floor((i / barCount) * features.fftMagnitudes.length);
    const energy = features.fftMagnitudes[fftIdx] || 0;
    const barH = energy * height * 0.4 + 2;
    const colorIdx = i % paletteColors.length;

    ctx.fillStyle = palColor(colorIdx, 0.3 + energy * 0.4);
    ctx.fillRect(i * barW, height - barH, barW - 1, barH);
  }
}

// ===== Render Loop =====
function render() {
  time += 0.016;

  // Fade to black (trail effect)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
  ctx.fillRect(0, 0, width, height);

  // Clear pet overlay
  petCtx.clearRect(0, 0, width, height);

  // Decay features if no data received recently
  const timeSinceFeature = performance.now() - lastFeatureTime;
  if (timeSinceFeature > 200) {
    features.beatPulse *= 0.9;
    features.amplitude *= 0.95;
    features.energyLow *= 0.95;
    features.energyMid *= 0.95;
    features.energyHigh *= 0.95;
    features.isBeat = false;
  }

  // Draw active visualizer
  switch (activeVizIndex) {
    case 0: drawNebula(); break;
    case 1: drawBassTunnel(); break;
    case 2: drawRibbonFlow(); break;
    case 3: drawPulseGrid(); break;
    case 4: drawPetGlow(); break;
    default: drawPetGlow(); break;
  }

  requestAnimationFrame(render);
}

// ===== Init =====
window.addEventListener('load', () => {
  initCanvas();
  initNebula();
  initCastReceiver();
  render();
});
