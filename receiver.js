/**
 * GlowJack — Chromecast Custom Receiver for GrooveGlow
 *
 * Receives AudioFeatures from the Android sender app via a custom Cast
 * messaging namespace, then renders visualizations on the TV using
 * HTML5 Canvas.
 *
 * Protocol:
 *   Namespace: urn:x-cast:com.grooveglow.viz
 *   Messages (JSON):
 *     { type: "features", data: { energyLow, energyMid, energyHigh, ... } }
 *     { type: "vizIndex", index: 0 }
 *     { type: "ping" }  →  { type: "pong" }
 *
 * Visualizers implemented:
 *   0: Nebula Swarm (particles)
 *   1: Bass Tunnel (expanding waveform rings)
 *   2: Ribbon Flow (flowing ribbons)
 *   3: Pulse Grid (grid of pulsing dots)
 *   4+ : Fallback to Nebula Swarm
 */

const NAMESPACE = 'urn:x-cast:com.grooveglow.viz';

// ===== State =====
let canvas, ctx;
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

// ===== Cast Receiver Setup =====
function initCastReceiver() {
  const context = cast.framework.CastReceiverContext.getInstance();
  const options = new cast.framework.CastReceiverOptions();
  options.disableIdleTimeout = true; // Keep receiver alive

  // Listen for custom messages
  context.addCustomMessageListener(NAMESPACE, (event) => {
    handleMessage(event.data);
  });

  context.addEventListener(
    cast.framework.system.EventType.SENDER_CONNECTED, () => {
      console.log('[GlowJack] Sender connected');
      connected = true;
      document.getElementById('status').classList.add('hidden');
    }
  );

  context.addEventListener(
    cast.framework.system.EventType.SENDER_DISCONNECTED, () => {
      console.log('[GlowJack] Sender disconnected');
      connected = false;
      document.getElementById('status').classList.remove('hidden');

      // Shut down after 30s without sender
      setTimeout(() => {
        if (!connected) {
          context.stop();
        }
      }, 30000);
    }
  );

  context.start(options);
  console.log('[GlowJack] Receiver started, waiting for sender...');
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
      console.log('[GlowJack] Viz index:', activeVizIndex);
      break;
    case 'ping':
      // Respond with pong (latency check)
      const ctx = cast.framework.CastReceiverContext.getInstance();
      ctx.sendCustomMessage(NAMESPACE, undefined, { type: 'pong' });
      break;
  }
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
  resize();
  window.addEventListener('resize', resize);
}

function resize() {
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = width;
  canvas.height = height;
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
      hue: Math.random() * 360,
      life: Math.random()
    });
  }
}

function drawNebula() {
  const { energyLow, energyHigh, beatPulse, amplitude, brightness } = features;
  const cx = width / 2, cy = height / 2;

  for (const p of nebulaParticles) {
    // Attract to center with bass
    const dx = cx - p.x, dy = cy - p.y;
    const dist = Math.sqrt(dx * dx + dy * dy) + 1;
    const attract = 0.5 + energyLow * 3;
    p.vx += (dx / dist) * attract * 0.01;
    p.vy += (dy / dist) * attract * 0.01;

    // Repel on beat
    if (features.isBeat) {
      const repel = 3 + beatPulse * 8;
      p.vx -= (dx / dist) * repel;
      p.vy -= (dy / dist) * repel;
    }

    // Swirl
    p.vx += (-dy / dist) * 0.3;
    p.vy += (dx / dist) * 0.3;

    // Damping
    p.vx *= 0.97;
    p.vy *= 0.97;

    p.x += p.vx;
    p.y += p.vy;

    // Wrap
    if (p.x < 0) p.x += width;
    if (p.x > width) p.x -= width;
    if (p.y < 0) p.y += height;
    if (p.y > height) p.y -= height;

    // Color cycling
    p.hue = (p.hue + 0.5 + energyHigh * 2) % 360;
    const sat = 70 + brightness * 30;
    const alpha = 0.3 + amplitude * 0.5 + beatPulse * 0.2;
    const size = p.size * (1 + beatPulse * 2);

    ctx.beginPath();
    ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${p.hue}, ${sat}%, 60%, ${Math.min(alpha, 1)})`;
    ctx.fill();

    // Glow
    if (size > 3) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, size * 2.5, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${p.hue}, ${sat}%, 60%, ${alpha * 0.1})`;
      ctx.fill();
    }
  }
}

// ===== Bass Tunnel Visualizer =====
const tunnelRings = [];
const MAX_RINGS = 30;

function drawBassTunnel() {
  const { energyLow, beatPulse, isBeat, waveform, brightness } = features;
  const cx = width / 2, cy = height / 2;
  const maxR = Math.min(width, height) * 0.45;

  // Spawn rings
  const spawnRate = 0.3 + energyLow * 4;
  if (Math.random() < spawnRate * 0.016 || isBeat) {
    if (tunnelRings.length < MAX_RINGS) {
      tunnelRings.push({
        radius: isBeat ? 8 : 3,
        thickness: isBeat ? 4 + beatPulse * 8 : 2 + energyLow * 4,
        alpha: 1,
        hue: Math.random() * 60,
        waveOff: Math.random(),
        waveAmp: 0.3 + features.amplitude * 1.5
      });
    }
  }

  // Update and draw
  const speed = 80 + energyLow * 300;
  const warm = brightness > 0.5;

  for (let i = tunnelRings.length - 1; i >= 0; i--) {
    const ring = tunnelRings[i];
    ring.radius += speed * 0.016;
    ring.alpha = Math.max(0, 1 - ring.radius / maxR);

    if (ring.radius > maxR || ring.alpha < 0.02) {
      tunnelRings.splice(i, 1);
      continue;
    }

    const hue = warm ? ring.hue : ring.hue + 180;
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
    ctx.strokeStyle = `hsla(${hue}, 70%, 60%, ${ring.alpha * 0.8})`;
    ctx.lineWidth = thickness;
    ctx.stroke();
  }

  // Center glow
  const glowA = Math.min(0.6, energyLow * 0.4 + beatPulse * 0.3);
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 40 + energyLow * 60);
  grad.addColorStop(0, `hsla(${warm ? 20 : 200}, 60%, 60%, ${glowA})`);
  grad.addColorStop(1, 'transparent');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
}

// ===== Ribbon Flow Visualizer =====
function drawRibbonFlow() {
  const { energyLow, energyMid, energyHigh, beatPulse, brightness, waveform } = features;
  const ribbonCount = 6;

  for (let r = 0; r < ribbonCount; r++) {
    const baseY = height * (0.15 + r * 0.12);
    const hue = (r * 50 + time * 30) % 360;
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
    ctx.strokeStyle = `hsla(${hue}, ${60 + brightness * 30}%, 55%, ${Math.min(alpha, 0.8)})`;
    ctx.lineWidth = 2 + energyLow * 3 + beatPulse * 4;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
}

// ===== Pulse Grid Visualizer =====
function drawPulseGrid() {
  const { fftMagnitudes, beatPulse, energyLow, brightness } = features;
  const cols = 16, rows = 10;
  const cellW = width / cols, cellH = height / rows;

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const cx = cellW * (gx + 0.5);
      const cy = cellH * (gy + 0.5);

      // Map grid position to FFT bin
      const fftIdx = Math.floor((gx / cols) * fftMagnitudes.length);
      const energy = fftMagnitudes[fftIdx] || 0;

      const radius = 3 + energy * cellW * 0.4 + beatPulse * 5;
      const hue = (gx * 20 + gy * 30 + time * 40) % 360;
      const alpha = 0.2 + energy * 0.6 + beatPulse * 0.2;

      // Glow
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 2, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${hue}, 70%, 50%, ${alpha * 0.15})`;
      ctx.fill();

      // Dot
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${hue}, ${60 + brightness * 30}%, 55%, ${Math.min(alpha, 0.9)})`;
      ctx.fill();
    }
  }
}

// ===== Render Loop =====
function render() {
  time += 0.016;

  // Fade to black (trail effect)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
  ctx.fillRect(0, 0, width, height);

  // If no features received recently, decay values
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
    default: drawNebula(); break; // Fallback for image-based modes
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
