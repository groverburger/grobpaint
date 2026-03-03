// ===== GrobPaint Renderer — compositing, checkerboard, zoom/pan =====

import { bus } from './core.js';

export class Renderer {
  constructor() {
    this.viewport = document.getElementById('viewport');
    this.bgCanvas = document.getElementById('canvas-bg');
    this.mainCanvas = document.getElementById('canvas-main');
    this.overlayCanvas = document.getElementById('canvas-overlay');
    this.bgCtx = this.bgCanvas.getContext('2d');
    this.mainCtx = this.mainCanvas.getContext('2d');
    this.overlayCtx = this.overlayCanvas.getContext('2d');
    this.doc = null;
    this._rafId = null;
    this._dirty = true;

    // Grid settings
    this.gridEnabled = false;
    this.gridSizeX = 16;
    this.gridSizeY = 16;
    this.gridColor = 'rgba(255,255,255,0.2)';

    bus.on('grid:toggle', () => { this.gridEnabled = !this.gridEnabled; this._dirty = true; });
    bus.on('grid:set-size', (x, y) => { this.gridSizeX = x; this.gridSizeY = y !== undefined ? y : x; this._dirty = true; });
    bus.on('grid:set-color', c => { this.gridColor = c; this._dirty = true; });

    // Checkerboard pattern
    this._checkerPattern = this._createCheckerPattern();

    this._resize();
    window.addEventListener('resize', () => this._resize());
    bus.on('doc:switched', doc => this.setDoc(doc));
    bus.on('canvas:dirty', () => this.markDirty());
    bus.on('render:overlay', () => this._renderOverlay());

    this._loop();
  }

  _createCheckerPattern() {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 16;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#999';
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = '#666';
    ctx.fillRect(0, 0, 8, 8);
    ctx.fillRect(8, 8, 8, 8);
    return c;
  }

  _resize() {
    const r = this.viewport.getBoundingClientRect();
    const oldW = this.mainCanvas.width;
    const oldH = this.mainCanvas.height;
    const w = Math.floor(r.width);
    const h = Math.floor(r.height);
    for (const c of [this.bgCanvas, this.mainCanvas, this.overlayCanvas]) {
      c.width = w;
      c.height = h;
      c.style.width = w + 'px';
      c.style.height = h + 'px';
    }
    // Keep document centered when viewport changes size
    if (this.doc && oldW > 0 && oldH > 0) {
      this.doc.panX += (w - oldW) / 2;
      this.doc.panY += (h - oldH) / 2;
    }
    this._dirty = true;
  }

  setDoc(doc) {
    this.doc = doc;
    this._dirty = true;
  }

  markDirty() { this._dirty = true; }

  get viewWidth() { return this.mainCanvas.width; }
  get viewHeight() { return this.mainCanvas.height; }

  _loop() {
    if (this._dirty) {
      this._dirty = false;
      this._render();
    }
    this._renderOverlay();
    this._rafId = requestAnimationFrame(() => this._loop());
  }

  _render() {
    const doc = this.doc;
    if (!doc) return;

    const { zoom, panX, panY, width, height } = doc;
    const vw = this.viewWidth;
    const vh = this.viewHeight;

    // Background: dark outside, checkerboard inside document area
    const bgCtx = this.bgCtx;
    bgCtx.clearRect(0, 0, vw, vh);
    bgCtx.fillStyle = '#181b24';
    bgCtx.fillRect(0, 0, vw, vh);

    // Checkerboard for transparency
    bgCtx.save();
    bgCtx.translate(panX, panY);
    bgCtx.scale(zoom, zoom);
    bgCtx.beginPath();
    bgCtx.rect(0, 0, width, height);
    bgCtx.clip();
    // tile the checkerboard
    const pattern = bgCtx.createPattern(this._checkerPattern, 'repeat');
    bgCtx.fillStyle = pattern;
    bgCtx.setTransform(1, 0, 0, 1, panX, panY); // pattern at 1:1 scale
    bgCtx.fillRect(0, 0, width * zoom, height * zoom);
    bgCtx.restore();

    // Composite layers
    doc.compositeAll();

    // Draw composite to main canvas
    const mainCtx = this.mainCtx;
    mainCtx.clearRect(0, 0, vw, vh);
    mainCtx.imageSmoothingEnabled = false;
    mainCtx.save();
    mainCtx.translate(panX, panY);
    mainCtx.scale(zoom, zoom);
    mainCtx.drawImage(doc.composite, 0, 0);
    mainCtx.restore();

    // Document border
    mainCtx.strokeStyle = 'rgba(255,255,255,0.2)';
    mainCtx.lineWidth = 1;
    mainCtx.strokeRect(panX - 0.5, panY - 0.5, width * zoom + 1, height * zoom + 1);
  }

  _renderOverlay() {
    const doc = this.doc;
    if (!doc) return;
    const ctx = this.overlayCtx;
    const vw = this.viewWidth;
    const vh = this.viewHeight;
    ctx.clearRect(0, 0, vw, vh);

    // Pixel grid
    if (this.gridEnabled) {
      this._drawGrid(ctx, doc);
    }

    // Marching ants for selection
    if (doc.selection.active) {
      doc.selection.drawAnts(ctx, doc.zoom, doc.panX, doc.panY);
    }

    // Tool overlay drawn by the current tool via bus event
    bus.emit('render:tool-overlay', ctx, doc);
  }

  _drawGrid(ctx, doc) {
    const { zoom, panX, panY, width, height } = doc;
    const gx = this.gridSizeX;
    const gy = this.gridSizeY;

    // Only draw when grid cells are at least 4 screen pixels
    if (gx * zoom < 4 && gy * zoom < 4) return;

    const vw = this.viewWidth;
    const vh = this.viewHeight;

    ctx.save();
    // Clip to document bounds
    ctx.beginPath();
    ctx.rect(panX, panY, width * zoom, height * zoom);
    ctx.clip();

    // Draw two passes: dark then light, visible on any background
    const passes = [
      { color: 'rgba(0,0,0,0.4)', offset: 0 },
      { color: 'rgba(255,255,255,0.4)', offset: 1 },
    ];

    for (const pass of passes) {
      ctx.strokeStyle = pass.color;
      ctx.lineWidth = 1;
      ctx.beginPath();

      if (gx * zoom >= 4) {
        const startCol = Math.max(0, Math.floor(-panX / (gx * zoom)) * gx);
        for (let x = startCol; x <= width; x += gx) {
          const sx = Math.round(x * zoom + panX) + 0.5 + pass.offset;
          ctx.moveTo(sx, Math.max(0, panY));
          ctx.lineTo(sx, Math.min(vh, panY + height * zoom));
        }
      }

      if (gy * zoom >= 4) {
        const startRow = Math.max(0, Math.floor(-panY / (gy * zoom)) * gy);
        for (let y = startRow; y <= height; y += gy) {
          const sy = Math.round(y * zoom + panY) + 0.5 + pass.offset;
          ctx.moveTo(Math.max(0, panX), sy);
          ctx.lineTo(Math.min(vw, panX + width * zoom), sy);
        }
      }

      ctx.stroke();
    }

    ctx.restore();
  }
}
