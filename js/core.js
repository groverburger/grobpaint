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
    this._contours = null; // precomputed contour paths for mask outline
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
    this._contours = null;
    this.active = true;
  }

  setMask(mask, bounds) {
    this.mask = mask;
    this.bounds = bounds;
    this._computeEdges();
    this.active = true;
  }

  clear() {
    this.mask = null;
    this.bounds = null;
    this._contours = null;
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

  /** Precompute contour paths for non-rectangular masks using edge tracing.
   *  Produces connected polylines instead of isolated segments for smooth dash rendering. */
  _computeEdges() {
    if (!this.mask || !this.bounds) { this._contours = null; return; }
    const { x: bx, y: by, w: bw, h: bh } = this.bounds;
    const W = this.width, mask = this.mask;

    // Build a set of directed edges between pixel corners.
    // Each edge goes from (x1,y1) to (x2,y2) where coords are pixel-corner coords.
    // For a selected pixel at (px,py), we add edges for each side that borders an unselected pixel.
    const edgeMap = new Map(); // "x,y" -> [{x2,y2}]
    const addEdge = (x1, y1, x2, y2) => {
      const key = x1 + ',' + y1;
      if (!edgeMap.has(key)) edgeMap.set(key, []);
      edgeMap.get(key).push({ x: x2, y: y2 });
    };

    for (let py = by; py < by + bh; py++) {
      for (let px = bx; px < bx + bw; px++) {
        if (!mask[py * W + px]) continue;
        // Top edge: if pixel above is not selected
        if (py === 0 || !mask[(py - 1) * W + px]) addEdge(px, py, px + 1, py);
        // Bottom edge
        if (py === this.height - 1 || !mask[(py + 1) * W + px]) addEdge(px + 1, py + 1, px, py + 1);
        // Left edge
        if (px === 0 || !mask[py * W + (px - 1)]) addEdge(px, py + 1, px, py);
        // Right edge
        if (px === this.width - 1 || !mask[py * W + (px + 1)]) addEdge(px + 1, py, px + 1, py + 1);
      }
    }

    // Trace connected contours by following directed edges
    const contours = []; // array of [{x,y}, ...]
    while (edgeMap.size > 0) {
      // Pick any starting edge
      const [startKey] = edgeMap.keys();
      const [sx, sy] = startKey.split(',').map(Number);
      const path = [{ x: sx, y: sy }];
      let cx = sx, cy = sy;
      while (true) {
        const key = cx + ',' + cy;
        const neighbors = edgeMap.get(key);
        if (!neighbors || neighbors.length === 0) {
          edgeMap.delete(key);
          break;
        }
        const next = neighbors.pop();
        if (neighbors.length === 0) edgeMap.delete(key);
        cx = next.x; cy = next.y;
        path.push({ x: cx, y: cy });
        if (cx === sx && cy === sy) break; // closed loop
      }
      if (path.length > 2) contours.push(path);
    }
    this._contours = contours.length > 0 ? contours : null;
  }

  /** Draw marching ants on the overlay ctx */
  drawAnts(ctx, zoom, panX, panY) {
    if (!this.active || !this.bounds) return;
    this._animOffset = (this._animOffset + 0.5) % 16;
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;

    if (this._contours) {
      // Non-rectangular mask: draw smooth contour paths
      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass === 0 ? 'white' : 'black';
        ctx.lineDashOffset = -(this._animOffset + pass * 4);
        ctx.beginPath();
        for (const path of this._contours) {
          ctx.moveTo(path[0].x * zoom + panX + 0.5, path[0].y * zoom + panY + 0.5);
          for (let i = 1; i < path.length; i++) {
            ctx.lineTo(path[i].x * zoom + panX + 0.5, path[i].y * zoom + panY + 0.5);
          }
        }
        ctx.stroke();
      }
    } else {
      // Rectangular selection: fast strokeRect path
      const b = this.bounds;
      const sx = b.x * zoom + panX + 0.5, sy = b.y * zoom + panY + 0.5;
      const sw = b.w * zoom, sh = b.h * zoom;
      ctx.lineDashOffset = -this._animOffset;
      ctx.strokeStyle = 'white';
      ctx.strokeRect(sx, sy, sw, sh);
      ctx.lineDashOffset = -(this._animOffset + 4);
      ctx.strokeStyle = 'black';
      ctx.strokeRect(sx, sy, sw, sh);
    }
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

  /** Save selection state for undo */
  saveSelectionState() {
    this.history.push({
      type: 'selection',
      mask: this.selection.mask ? new Uint8Array(this.selection.mask) : null,
      bounds: this.selection.bounds ? { ...this.selection.bounds } : null,
      active: this.selection.active,
    });
  }

  /** Save full structure state for undo (add/delete/reorder layers) */
  saveStructureState() {
    this.history.push({
      type: 'structure',
      width: this.width,
      height: this.height,
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
    } else if (state.type === 'selection') {
      const cur = {
        type: 'selection',
        mask: this.selection.mask ? new Uint8Array(this.selection.mask) : null,
        bounds: this.selection.bounds ? { ...this.selection.bounds } : null,
        active: this.selection.active,
      };
      if (state.mask) {
        this.selection.mask = state.mask;
        this.selection.bounds = state.bounds;
        this.selection._computeEdges();
        this.selection.active = state.active;
      } else {
        this.selection.clear();
      }
      state.mask = cur.mask;
      state.bounds = cur.bounds;
      state.active = cur.active;
    } else if (state.type === 'structure') {
      // Save current for redo
      const current = {
        type: 'structure',
        width: this.width,
        height: this.height,
        layerCount: this.layers.length,
        activeIndex: this.activeLayerIndex,
        layers: this.layers.map(l => ({
          imageData: l.getSnapshot(),
          name: l.name, opacity: l.opacity,
          visible: l.visible, blendMode: l.blendMode,
        })),
      };
      // Restore dimensions
      const restoreW = state.width || this.width;
      const restoreH = state.height || this.height;
      this.width = restoreW;
      this.height = restoreH;
      this.composite.width = restoreW;
      this.composite.height = restoreH;
      this.selection = new Selection(restoreW, restoreH);
      // Restore layers
      this.layers = state.layers.map(s => {
        const l = new Layer(restoreW, restoreH, s.name);
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
      state.width = current.width;
      state.height = current.height;
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
    } else if (state.type === 'selection') {
      const cur = {
        type: 'selection',
        mask: this.selection.mask ? new Uint8Array(this.selection.mask) : null,
        bounds: this.selection.bounds ? { ...this.selection.bounds } : null,
        active: this.selection.active,
      };
      if (state.mask) {
        this.selection.mask = state.mask;
        this.selection.bounds = state.bounds;
        this.selection._computeEdges();
        this.selection.active = state.active;
      } else {
        this.selection.clear();
      }
      state.mask = cur.mask;
      state.bounds = cur.bounds;
      state.active = cur.active;
    } else if (state.type === 'structure') {
      const current = {
        type: 'structure',
        width: this.width,
        height: this.height,
        layerCount: this.layers.length,
        activeIndex: this.activeLayerIndex,
        layers: this.layers.map(l => ({
          imageData: l.getSnapshot(),
          name: l.name, opacity: l.opacity,
          visible: l.visible, blendMode: l.blendMode,
        })),
      };
      const restoreW = state.width || this.width;
      const restoreH = state.height || this.height;
      this.width = restoreW;
      this.height = restoreH;
      this.composite.width = restoreW;
      this.composite.height = restoreH;
      this.selection = new Selection(restoreW, restoreH);
      this.layers = state.layers.map(s => {
        const l = new Layer(restoreW, restoreH, s.name);
        l.restoreSnapshot(s.imageData);
        l.opacity = s.opacity; l.visible = s.visible; l.blendMode = s.blendMode;
        return l;
      });
      this.activeLayerIndex = state.activeIndex;
      state.layers = current.layers;
      state.activeIndex = current.activeIndex;
      state.width = current.width;
      state.height = current.height;
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
