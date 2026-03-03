// ===== GrobPaint Core — EventBus, Layer, History, PaintDocument, Selection =====

export class EventBus {
  constructor() { this._listeners = {}; }
  on(event, fn) {
    (this._listeners[event] ||= []).push(fn);
    return () => this.off(event, fn);
  }
  off(event, fn) {
    const a = this._listeners[event];
    if (a) this._listeners[event] = a.filter(f => f !== fn);
  }
  emit(event, ...args) {
    for (const fn of this._listeners[event] || []) fn(...args);
  }
}

export class Layer {
  constructor(width, height, name = 'Layer') {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d');
    this.name = name;
    this.opacity = 1;
    this.visible = true;
    this.blendMode = 'source-over';
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  getSnapshot() {
    return this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
  }

  restoreSnapshot(imageData) {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.putImageData(imageData, 0, 0);
  }

  clone() {
    const l = new Layer(this.canvas.width, this.canvas.height, this.name);
    l.ctx.drawImage(this.canvas, 0, 0);
    l.opacity = this.opacity;
    l.visible = this.visible;
    l.blendMode = this.blendMode;
    return l;
  }

  toDataURL() {
    return this.canvas.toDataURL('image/png');
  }
}

export class History {
  constructor(maxSteps = 50) {
    this.states = [];
    this.index = -1;
    this.maxSteps = maxSteps;
  }

  /** Save a state snapshot. state = { layerIndex, imageData, layerMeta? } or { type:'structure', snapshot } */
  push(state) {
    // discard any redo states
    this.states = this.states.slice(0, this.index + 1);
    this.states.push(state);
    if (this.states.length > this.maxSteps) this.states.shift();
    this.index = this.states.length - 1;
  }

  canUndo() { return this.index >= 0; }
  canRedo() { return this.index < this.states.length - 1; }

  undo() {
    if (!this.canUndo()) return null;
    return this.states[this.index--];
  }

  redo() {
    if (!this.canRedo()) return null;
    return this.states[++this.index];
  }

  clear() {
    this.states = [];
    this.index = -1;
  }
}

export class Selection {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.mask = null; // Uint8Array, 1=selected, 0=not
    this.bounds = null; // {x, y, w, h} or null
    this.active = false;
    this._animOffset = 0;
  }

  setRect(x, y, w, h) {
    x = Math.max(0, Math.round(x));
    y = Math.max(0, Math.round(y));
    w = Math.min(this.width - x, Math.round(w));
    h = Math.min(this.height - y, Math.round(h));
    if (w <= 0 || h <= 0) { this.clear(); return; }
    this.mask = new Uint8Array(this.width * this.height);
    for (let row = y; row < y + h; row++)
      for (let col = x; col < x + w; col++)
        this.mask[row * this.width + col] = 1;
    this.bounds = { x, y, w, h };
    this.active = true;
  }

  setMask(mask, bounds) {
    this.mask = mask;
    this.bounds = bounds;
    this.active = true;
  }

  clear() {
    this.mask = null;
    this.bounds = null;
    this.active = false;
  }

  isSelected(px, py) {
    if (!this.active || !this.mask) return true;
    if (px < 0 || px >= this.width || py < 0 || py >= this.height) return false;
    return this.mask[py * this.width + px] === 1;
  }

  /** Create a clipping canvas from the mask */
  clipCanvas() {
    if (!this.active || !this.mask) return null;
    const c = document.createElement('canvas');
    c.width = this.width;
    c.height = this.height;
    const ctx = c.getContext('2d');
    const id = ctx.createImageData(this.width, this.height);
    for (let i = 0; i < this.mask.length; i++) {
      if (this.mask[i]) {
        id.data[i * 4 + 3] = 255;
      }
    }
    ctx.putImageData(id, 0, 0);
    return c;
  }

  /** Apply this selection as a clip region on the given context. Call ctx.save() before, ctx.restore() after. */
  applyClip(ctx) {
    if (!this.active || !this.bounds) return;
    const b = this.bounds;
    if (this._isRectangular()) {
      ctx.beginPath();
      ctx.rect(b.x, b.y, b.w, b.h);
      ctx.clip();
    } else {
      // Arbitrary mask: use clip canvas as a compositing mask
      // We clip to the bounding rect as an approximation for path-based tools.
      // Pixel-level masking is handled post-draw by _maskLayer().
      ctx.beginPath();
      ctx.rect(b.x, b.y, b.w, b.h);
      ctx.clip();
    }
  }

  /** Check if the selection is a simple rectangle (all pixels in bounds selected) */
  _isRectangular() {
    if (!this.mask || !this.bounds) return false;
    const { x, y, w, h } = this.bounds;
    for (let row = y; row < y + h; row++)
      for (let col = x; col < x + w; col++)
        if (!this.mask[row * this.width + col]) return false;
    return true;
  }

  /**
   * Post-draw mask enforcement: erase any pixels in the layer that were drawn
   * outside the selection. Call with the layer's snapshot from before the draw.
   */
  maskLayer(layer, beforeSnapshot) {
    if (!this.active || !this.mask || this._isRectangular()) return;
    const cur = layer.ctx.getImageData(0, 0, this.width, this.height);
    const prev = beforeSnapshot.data;
    const data = cur.data;
    for (let i = 0; i < this.mask.length; i++) {
      if (!this.mask[i]) {
        // Restore original pixel
        const pi = i * 4;
        data[pi] = prev[pi];
        data[pi + 1] = prev[pi + 1];
        data[pi + 2] = prev[pi + 2];
        data[pi + 3] = prev[pi + 3];
      }
    }
    layer.ctx.putImageData(cur, 0, 0);
  }

  /** Draw marching ants on the overlay ctx */
  drawAnts(ctx, zoom, panX, panY) {
    if (!this.active || !this.bounds) return;
    this._animOffset = (this._animOffset + 0.5) % 16;
    const b = this.bounds;
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = -this._animOffset;
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      b.x * zoom + panX + 0.5,
      b.y * zoom + panY + 0.5,
      b.w * zoom,
      b.h * zoom
    );
    ctx.strokeStyle = 'black';
    ctx.lineDashOffset = -(this._animOffset + 4);
    ctx.strokeRect(
      b.x * zoom + panX + 0.5,
      b.y * zoom + panY + 0.5,
      b.w * zoom,
      b.h * zoom
    );
    ctx.restore();
  }
}

export class PaintDocument {
  constructor(width, height, name = 'Untitled', bgColor = 'white') {
    this.width = width;
    this.height = height;
    this.name = name;
    this.path = null;
    this.projectPath = null;
    this.layers = [];
    this.activeLayerIndex = 0;
    this.history = new History();
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.selection = new Selection(width, height);
    this.dirty = false;

    // Composite canvas
    this.composite = document.createElement('canvas');
    this.composite.width = width;
    this.composite.height = height;
    this.compositeCtx = this.composite.getContext('2d');

    // Create initial layer
    const layer = new Layer(width, height, 'Background');
    if (bgColor === 'white') {
      layer.ctx.fillStyle = '#ffffff';
      layer.ctx.fillRect(0, 0, width, height);
    } else if (bgColor === 'black') {
      layer.ctx.fillStyle = '#000000';
      layer.ctx.fillRect(0, 0, width, height);
    }
    this.layers.push(layer);
  }

  get activeLayer() {
    return this.layers[this.activeLayerIndex];
  }

  addLayer(name, index) {
    const layer = new Layer(this.width, this.height, name || `Layer ${this.layers.length + 1}`);
    const idx = index !== undefined ? index : this.activeLayerIndex + 1;
    this.layers.splice(idx, 0, layer);
    this.activeLayerIndex = idx;
    return layer;
  }

  removeLayer(index) {
    if (this.layers.length <= 1) return;
    const idx = index !== undefined ? index : this.activeLayerIndex;
    this.layers.splice(idx, 1);
    if (this.activeLayerIndex >= this.layers.length)
      this.activeLayerIndex = this.layers.length - 1;
  }

  moveLayer(from, to) {
    if (to < 0 || to >= this.layers.length) return;
    const [layer] = this.layers.splice(from, 1);
    this.layers.splice(to, 0, layer);
    this.activeLayerIndex = to;
  }

  duplicateLayer(index) {
    const idx = index !== undefined ? index : this.activeLayerIndex;
    const clone = this.layers[idx].clone();
    clone.name = clone.name + ' copy';
    this.layers.splice(idx + 1, 0, clone);
    this.activeLayerIndex = idx + 1;
  }

  mergeDown(index) {
    const idx = index !== undefined ? index : this.activeLayerIndex;
    if (idx <= 0) return;
    const upper = this.layers[idx];
    const lower = this.layers[idx - 1];
    lower.ctx.globalAlpha = upper.opacity;
    lower.ctx.globalCompositeOperation = upper.blendMode;
    lower.ctx.drawImage(upper.canvas, 0, 0);
    lower.ctx.globalAlpha = 1;
    lower.ctx.globalCompositeOperation = 'source-over';
    this.layers.splice(idx, 1);
    this.activeLayerIndex = idx - 1;
  }

  /** Resize the canvas. offsetX/Y control where old content is placed in the new canvas. */
  resizeCanvas(newW, newH, offsetX = 0, offsetY = 0) {
    for (const layer of this.layers) {
      const old = document.createElement('canvas');
      old.width = layer.canvas.width;
      old.height = layer.canvas.height;
      old.getContext('2d').drawImage(layer.canvas, 0, 0);
      layer.canvas.width = newW;
      layer.canvas.height = newH;
      layer.ctx.clearRect(0, 0, newW, newH);
      layer.ctx.drawImage(old, offsetX, offsetY);
    }
    this.width = newW;
    this.height = newH;
    this.composite.width = newW;
    this.composite.height = newH;
    this.selection = new Selection(newW, newH);
  }

  /** Crop all layers to the current selection bounds. */
  cropToSelection() {
    if (!this.selection.active || !this.selection.bounds) return;
    const { x, y, w, h } = this.selection.bounds;
    if (w <= 0 || h <= 0) return;
    for (const layer of this.layers) {
      const cropped = layer.ctx.getImageData(x, y, w, h);
      layer.canvas.width = w;
      layer.canvas.height = h;
      layer.ctx.putImageData(cropped, 0, 0);
    }
    this.width = w;
    this.height = h;
    this.composite.width = w;
    this.composite.height = h;
    this.selection = new Selection(w, h);
  }

  /** Scale entire image to new dimensions */
  scaleImage(newW, newH, interpolation = 'bilinear') {
    for (const layer of this.layers) {
      const old = document.createElement('canvas');
      old.width = layer.canvas.width;
      old.height = layer.canvas.height;
      old.getContext('2d').drawImage(layer.canvas, 0, 0);
      layer.canvas.width = newW;
      layer.canvas.height = newH;
      layer.ctx.imageSmoothingEnabled = interpolation !== 'nearest';
      if (interpolation === 'bicubic') layer.ctx.imageSmoothingQuality = 'high';
      else layer.ctx.imageSmoothingQuality = 'low';
      layer.ctx.drawImage(old, 0, 0, newW, newH);
      layer.ctx.imageSmoothingEnabled = false;
    }
    this.width = newW;
    this.height = newH;
    this.composite.width = newW;
    this.composite.height = newH;
    this.selection = new Selection(newW, newH);
  }

  /** Build composite from all visible layers */
  compositeAll() {
    const ctx = this.compositeCtx;
    ctx.clearRect(0, 0, this.width, this.height);
    for (const layer of this.layers) {
      if (!layer.visible) continue;
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = layer.blendMode;
      ctx.drawImage(layer.canvas, 0, 0);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Save state for undo before a draw operation */
  saveDrawState(layerIndex) {
    const idx = layerIndex !== undefined ? layerIndex : this.activeLayerIndex;
    this.history.push({
      type: 'draw',
      layerIndex: idx,
      imageData: this.layers[idx].getSnapshot(),
    });
    this.dirty = true;
  }

  /** Save full structure state for undo (add/delete/reorder layers) */
  saveStructureState() {
    this.history.push({
      type: 'structure',
      layerCount: this.layers.length,
      activeIndex: this.activeLayerIndex,
      layers: this.layers.map(l => ({
        imageData: l.getSnapshot(),
        name: l.name,
        opacity: l.opacity,
        visible: l.visible,
        blendMode: l.blendMode,
      })),
    });
    this.dirty = true;
  }

  undo() {
    const state = this.history.undo();
    if (!state) return false;
    if (state.type === 'draw') {
      // Save current state for redo before restoring
      const current = this.layers[state.layerIndex].getSnapshot();
      this.layers[state.layerIndex].restoreSnapshot(state.imageData);
      state.imageData = current; // swap for redo
    } else if (state.type === 'structure') {
      // Save current for redo
      const current = {
        type: 'structure',
        layerCount: this.layers.length,
        activeIndex: this.activeLayerIndex,
        layers: this.layers.map(l => ({
          imageData: l.getSnapshot(),
          name: l.name, opacity: l.opacity,
          visible: l.visible, blendMode: l.blendMode,
        })),
      };
      // Restore
      this.layers = state.layers.map(s => {
        const l = new Layer(this.width, this.height, s.name);
        l.restoreSnapshot(s.imageData);
        l.opacity = s.opacity;
        l.visible = s.visible;
        l.blendMode = s.blendMode;
        return l;
      });
      this.activeLayerIndex = state.activeIndex;
      // Swap for redo
      state.layers = current.layers;
      state.activeIndex = current.activeIndex;
      state.layerCount = current.layerCount;
    }
    return true;
  }

  redo() {
    const state = this.history.redo();
    if (!state) return false;
    if (state.type === 'draw') {
      const current = this.layers[state.layerIndex].getSnapshot();
      this.layers[state.layerIndex].restoreSnapshot(state.imageData);
      state.imageData = current;
    } else if (state.type === 'structure') {
      const current = {
        type: 'structure',
        layerCount: this.layers.length,
        activeIndex: this.activeLayerIndex,
        layers: this.layers.map(l => ({
          imageData: l.getSnapshot(),
          name: l.name, opacity: l.opacity,
          visible: l.visible, blendMode: l.blendMode,
        })),
      };
      this.layers = state.layers.map(s => {
        const l = new Layer(this.width, this.height, s.name);
        l.restoreSnapshot(s.imageData);
        l.opacity = s.opacity; l.visible = s.visible; l.blendMode = s.blendMode;
        return l;
      });
      this.activeLayerIndex = state.activeIndex;
      state.layers = current.layers;
      state.activeIndex = current.activeIndex;
    }
    return true;
  }

  /** Convert screen coords to document coords */
  screenToDoc(sx, sy) {
    return {
      x: (sx - this.panX) / this.zoom,
      y: (sy - this.panY) / this.zoom,
    };
  }

  /** Fit document in viewport */
  fitInView(viewW, viewH) {
    const scale = Math.min(viewW / this.width, viewH / this.height) * 0.9;
    this.zoom = Math.min(scale, 1);
    this.panX = (viewW - this.width * this.zoom) / 2;
    this.panY = (viewH - this.height * this.zoom) / 2;
  }
}

// ===== Singleton bus =====
export const bus = new EventBus();
