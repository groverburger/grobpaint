// ===== GrobPaint Tools — all 11 tools + ToolManager =====

import { bus } from './core.js';

// ===== Helpers =====

function lerp(a, b, t) { return a + (b - a) * t; }

/** Bresenham line — calls cb(x, y) for each pixel */
function bresenhamLine(x0, y0, x1, y1, cb) {
  x0 = Math.round(x0); y0 = Math.round(y0);
  x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  while (true) {
    cb(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
}

/** Interpolate points for smooth brush strokes */
function interpolatePoints(x0, y0, x1, y1, spacing) {
  const dx = x1 - x0, dy = y1 - y0;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const points = [];
  if (dist < spacing) {
    points.push({ x: x1, y: y1 });
  } else {
    const steps = Math.ceil(dist / spacing);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      points.push({ x: lerp(x0, x1, t), y: lerp(y0, y1, t) });
    }
  }
  return points;
}

/** Flood fill on ImageData — returns modified ImageData. selMask is optional Uint8Array selection mask. */
export function floodFill(imageData, startX, startY, fillR, fillG, fillB, fillA, tolerance, selMask) {
  const { width, height, data } = imageData;
  startX = Math.round(startX);
  startY = Math.round(startY);
  if (startX < 0 || startX >= width || startY < 0 || startY >= height) return imageData;

  const si = (startY * width + startX) * 4;
  const sr = data[si], sg = data[si + 1], sb = data[si + 2], sa = data[si + 3];

  // Early exit if same color
  if (sr === fillR && sg === fillG && sb === fillB && sa === fillA) return imageData;

  const tol = tolerance * 4;
  const visited = new Uint8Array(width * height);
  const stack = [startX, startY];

  while (stack.length > 0) {
    const y = stack.pop();
    const x = stack.pop();
    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    const idx = y * width + x;
    if (visited[idx]) continue;
    // Respect selection mask
    if (selMask && !selMask[idx]) continue;

    const pi = idx * 4;
    const diff = Math.abs(data[pi] - sr) + Math.abs(data[pi + 1] - sg)
               + Math.abs(data[pi + 2] - sb) + Math.abs(data[pi + 3] - sa);
    if (diff > tol) continue;

    visited[idx] = 1;
    data[pi] = fillR;
    data[pi + 1] = fillG;
    data[pi + 2] = fillB;
    data[pi + 3] = fillA;

    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  return imageData;
}

/** Flood select — returns { mask, bounds } */
export function floodSelect(imageData, startX, startY, tolerance) {
  const { width, height, data } = imageData;
  startX = Math.round(startX);
  startY = Math.round(startY);
  if (startX < 0 || startX >= width || startY < 0 || startY >= height) return null;

  const si = (startY * width + startX) * 4;
  const sr = data[si], sg = data[si + 1], sb = data[si + 2], sa = data[si + 3];
  const tol = tolerance * 4;
  const mask = new Uint8Array(width * height);
  const stack = [startX, startY];
  let minX = startX, maxX = startX, minY = startY, maxY = startY;

  while (stack.length > 0) {
    const y = stack.pop();
    const x = stack.pop();
    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    const idx = y * width + x;
    if (mask[idx]) continue;

    const pi = idx * 4;
    const diff = Math.abs(data[pi] - sr) + Math.abs(data[pi + 1] - sg)
               + Math.abs(data[pi + 2] - sb) + Math.abs(data[pi + 3] - sa);
    if (diff > tol) continue;

    mask[idx] = 1;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;

    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  return { mask, bounds: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } };
}

/** Global select — selects ALL pixels matching target color, not just connected */
export function globalSelect(imageData, startX, startY, tolerance) {
  const { width, height, data } = imageData;
  startX = Math.round(startX);
  startY = Math.round(startY);
  if (startX < 0 || startX >= width || startY < 0 || startY >= height) return null;

  const si = (startY * width + startX) * 4;
  const sr = data[si], sg = data[si + 1], sb = data[si + 2], sa = data[si + 3];
  const tol = tolerance * 4;
  const mask = new Uint8Array(width * height);
  let minX = width, maxX = 0, minY = height, maxY = 0;
  let found = false;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pi = (y * width + x) * 4;
      const diff = Math.abs(data[pi] - sr) + Math.abs(data[pi + 1] - sg)
                 + Math.abs(data[pi + 2] - sb) + Math.abs(data[pi + 3] - sa);
      if (diff <= tol) {
        mask[y * width + x] = 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        found = true;
      }
    }
  }
  if (!found) return null;
  return { mask, bounds: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } };
}

/** Parse CSS color to {r,g,b,a} */
export function parseColor(str) {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.fillStyle = str;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return { r, g, b, a };
}

// ===== Shared Handle Helpers =====

/** Get 8 handle positions around a bounding box {x, y, w, h} in doc coords */
function getHandles(b) {
  if (!b) return [];
  const { x, y, w, h } = b;
  const mx = x + w / 2, my = y + h / 2;
  return [
    { id: 'nw', x: x,     y: y,     cursor: 'nwse-resize' },
    { id: 'n',  x: mx,    y: y,     cursor: 'ns-resize'   },
    { id: 'ne', x: x + w, y: y,     cursor: 'nesw-resize' },
    { id: 'e',  x: x + w, y: my,    cursor: 'ew-resize'   },
    { id: 'se', x: x + w, y: y + h, cursor: 'nwse-resize' },
    { id: 's',  x: mx,    y: y + h, cursor: 'ns-resize'   },
    { id: 'sw', x: x,     y: y + h, cursor: 'nesw-resize' },
    { id: 'w',  x: x,     y: my,    cursor: 'ew-resize'   },
  ];
}

/** Hit-test handles for a given bounding box, returns handle object or null */
function hitHandle(doc, bounds, mx, my) {
  if (!bounds) return null;
  const handles = getHandles(bounds);
  const z = doc.zoom;
  const threshold = 6;
  const smx = mx * z + doc.panX;
  const smy = my * z + doc.panY;
  for (const h of handles) {
    const sx = h.x * z + doc.panX;
    const sy = h.y * z + doc.panY;
    if (Math.abs(smx - sx) < threshold && Math.abs(smy - sy) < threshold) {
      return h;
    }
  }
  return null;
}

/** Draw 8 resize handles on overlay for a bounding box */
function drawHandles(ctx, doc, bounds) {
  if (!bounds) return;
  const handles = getHandles(bounds);
  const z = doc.zoom;
  const size = 5;
  ctx.fillStyle = 'white';
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  for (const h of handles) {
    const sx = Math.round(h.x * z + doc.panX);
    const sy = Math.round(h.y * z + doc.panY);
    ctx.fillRect(sx - size, sy - size, size * 2, size * 2);
    ctx.strokeRect(sx - size, sy - size, size * 2, size * 2);
  }
}

/** Apply handle drag delta to an original bounding box, returns new {x, y, w, h} */
function applyHandleDrag(handleId, origBounds, dx, dy) {
  let { x, y, w, h } = origBounds;
  if (handleId.includes('w')) { x += dx; w -= dx; }
  if (handleId.includes('e')) { w += dx; }
  if (handleId.includes('n')) { y += dy; h -= dy; }
  if (handleId.includes('s')) { h += dy; }
  // Flip if dragged past opposite edge
  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }
  return { x, y, w: Math.max(1, w), h: Math.max(1, h) };
}

// ===== Tool Base =====

class Tool {
  constructor(name, key) {
    this.name = name;
    this.key = key;
  }
  onPointerDown(doc, x, y, e) {}
  onPointerMove(doc, x, y, e) {}
  onPointerUp(doc, x, y, e) {}
  onOverlay(ctx, doc) {}
  getOptions() { return []; }
  activate() {}
  deactivate() {}
}

// ===== Pencil =====

export class PencilTool extends Tool {
  constructor() {
    super('Pencil', 'p');
    this._drawing = false;
    this._lastX = 0;
    this._lastY = 0;
    this._button = 0;
  }

  onPointerDown(doc, x, y, e) {
    const layer = doc.activeLayer;
    if (!layer || !layer.visible) return;
    doc.saveDrawState();
    this._drawing = true;
    this._button = e.button;
    this._lastX = Math.floor(x);
    this._lastY = Math.floor(y);
    const color = this._button === 2 ? bus._secondaryColor : bus._primaryColor;
    layer.ctx.fillStyle = color;
    layer.ctx.globalAlpha = bus._brushAlpha;
    if (doc.selection.active && doc.selection.mask) {
      if (!doc.selection.isSelected(this._lastX, this._lastY)) return;
    }
    layer.ctx.fillRect(this._lastX, this._lastY, 1, 1);
    bus.emit('canvas:dirty');
  }

  onPointerMove(doc, x, y, e) {
    if (!this._drawing) return;
    const layer = doc.activeLayer;
    const color = this._button === 2 ? bus._secondaryColor : bus._primaryColor;
    layer.ctx.fillStyle = color;
    layer.ctx.globalAlpha = bus._brushAlpha;
    const px = Math.floor(x), py = Math.floor(y);
    const sel = doc.selection;
    bresenhamLine(this._lastX, this._lastY, px, py, (lx, ly) => {
      if (!sel.active || sel.isSelected(lx, ly))
        layer.ctx.fillRect(lx, ly, 1, 1);
    });
    this._lastX = px;
    this._lastY = py;
    bus.emit('canvas:dirty');
  }

  onPointerUp(doc) {
    if (!this._drawing) return;
    this._drawing = false;
    layer_ctx_reset(doc.activeLayer);
  }
}

// ===== Brush =====

export class BrushTool extends Tool {
  constructor() {
    super('Brush', 'b');
    this._drawing = false;
    this._lastX = 0;
    this._lastY = 0;
    this._button = 0;
    this._preSelSnap = null;
  }

  onPointerDown(doc, x, y, e) {
    const layer = doc.activeLayer;
    if (!layer || !layer.visible) return;
    doc.saveDrawState();
    this._drawing = true;
    this._button = e.button;
    this._lastX = x;
    this._lastY = y;
    this._preSelSnap = doc.selection.active ? layer.getSnapshot() : null;
    this._drawDab(doc, layer, x, y);
    bus.emit('canvas:dirty');
  }

  onPointerMove(doc, x, y, e) {
    if (!this._drawing) return;
    const layer = doc.activeLayer;
    const spacing = Math.max(1, bus._brushSize / 4);
    const points = interpolatePoints(this._lastX, this._lastY, x, y, spacing);
    for (const p of points) this._drawDab(doc, layer, p.x, p.y);
    this._lastX = x;
    this._lastY = y;
    bus.emit('canvas:dirty');
  }

  onPointerUp(doc) {
    if (!this._drawing) return;
    this._drawing = false;
    if (this._preSelSnap && doc.selection.active) {
      doc.selection.maskLayer(doc.activeLayer, this._preSelSnap);
    }
    this._preSelSnap = null;
    layer_ctx_reset(doc.activeLayer);
  }

  _drawDab(doc, layer, x, y) {
    const ctx = layer.ctx;
    const color = this._button === 2 ? bus._secondaryColor : bus._primaryColor;
    const size = bus._brushSize;
    ctx.save();
    if (doc.selection.active) doc.selection.applyClip(ctx);
    ctx.fillStyle = color;
    ctx.globalAlpha = bus._brushAlpha;
    if (bus._antiAlias) {
      ctx.beginPath();
      ctx.arc(x, y, size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const r = Math.floor(size / 2);
      ctx.fillRect(Math.floor(x) - r, Math.floor(y) - r, size, size);
    }
    ctx.restore();
  }

  onOverlay(ctx, doc) {
    if (!this._drawing) {
      // Show brush cursor preview
      const vp = document.getElementById('viewport');
      const r = vp.getBoundingClientRect();
      const mx = bus._mouseX - r.left;
      const my = bus._mouseY - r.top;
      if (mx >= 0 && my >= 0) {
        const size = bus._brushSize * doc.zoom;
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(mx, my, size / 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
}

// ===== Eraser =====

export class EraserTool extends Tool {
  constructor() {
    super('Eraser', 'e');
    this._drawing = false;
    this._lastX = 0;
    this._lastY = 0;
    this._preSelSnap = null;
  }

  onPointerDown(doc, x, y, e) {
    const layer = doc.activeLayer;
    if (!layer || !layer.visible) return;
    doc.saveDrawState();
    this._drawing = true;
    this._lastX = x;
    this._lastY = y;
    this._preSelSnap = doc.selection.active ? layer.getSnapshot() : null;
    this._erase(doc, layer, x, y);
    bus.emit('canvas:dirty');
  }

  onPointerMove(doc, x, y, e) {
    if (!this._drawing) return;
    const layer = doc.activeLayer;
    const spacing = Math.max(1, bus._brushSize / 4);
    const points = interpolatePoints(this._lastX, this._lastY, x, y, spacing);
    for (const p of points) this._erase(doc, layer, p.x, p.y);
    this._lastX = x;
    this._lastY = y;
    bus.emit('canvas:dirty');
  }

  onPointerUp(doc) {
    if (!this._drawing) return;
    this._drawing = false;
    if (this._preSelSnap && doc.selection.active) {
      doc.selection.maskLayer(doc.activeLayer, this._preSelSnap);
    }
    this._preSelSnap = null;
    layer_ctx_reset(doc.activeLayer);
  }

  _erase(doc, layer, x, y) {
    const ctx = layer.ctx;
    const size = bus._brushSize;
    ctx.save();
    if (doc.selection.active) doc.selection.applyClip(ctx);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = bus._brushAlpha;
    if (bus._antiAlias) {
      ctx.beginPath();
      ctx.arc(x, y, size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const r = Math.floor(size / 2);
      ctx.fillRect(Math.floor(x) - r, Math.floor(y) - r, size, size);
    }
    ctx.restore();
  }

  onOverlay(ctx, doc) {
    const vp = document.getElementById('viewport');
    const r = vp.getBoundingClientRect();
    const mx = bus._mouseX - r.left;
    const my = bus._mouseY - r.top;
    if (mx >= 0 && my >= 0) {
      const size = bus._brushSize * doc.zoom;
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(mx, my, size / 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

// ===== Fill =====

export class FillTool extends Tool {
  constructor() {
    super('Fill', 'f');
  }

  onPointerDown(doc, x, y, e) {
    const layer = doc.activeLayer;
    if (!layer || !layer.visible) return;
    const fx = Math.floor(x), fy = Math.floor(y);
    // If selection active and click is outside it, do nothing
    if (doc.selection.active && !doc.selection.isSelected(fx, fy)) return;
    doc.saveDrawState();
    const color = e.button === 2 ? bus._secondaryColor : bus._primaryColor;
    const { r, g, b } = parseColor(color);
    const a = Math.round(bus._brushAlpha * 255);
    const imageData = layer.ctx.getImageData(0, 0, doc.width, doc.height);
    const selMask = doc.selection.active ? doc.selection.mask : null;
    floodFill(imageData, fx, fy, r, g, b, a, bus._tolerance, selMask);
    layer.ctx.putImageData(imageData, 0, 0);
    bus.emit('canvas:dirty');
  }
}

// ===== Eyedropper =====

export class EyedropperTool extends Tool {
  constructor() {
    super('Eyedropper', 'i');
    this._button = 0;
  }

  onPointerDown(doc, x, y, e) {
    this._button = e.button;
    this._pick(doc, x, y);
  }

  onPointerMove(doc, x, y, e) {
    if (e.buttons) this._pick(doc, x, y);
  }

  _pick(doc, x, y) {
    const layer = doc.activeLayer;
    if (!layer) return;
    const px = Math.floor(x), py = Math.floor(y);
    if (px < 0 || px >= doc.width || py < 0 || py >= doc.height) return;
    const data = layer.ctx.getImageData(px, py, 1, 1).data;
    const hex = '#' + [data[0], data[1], data[2]].map(v => v.toString(16).padStart(2, '0')).join('');
    if (this._button === 2) {
      bus.emit('color:set-secondary', hex);
    } else {
      bus.emit('color:set-primary', hex);
    }
  }
}

// ===== Line =====

export class LineTool extends Tool {
  constructor() {
    super('Line', 'l');
    this._drawing = false;
    this._startX = 0; this._startY = 0;
    this._endX = 0; this._endY = 0;
  }

  onPointerDown(doc, x, y, e) {
    this._drawing = true;
    this._startX = x; this._startY = y;
    this._endX = x; this._endY = y;
    this._button = e.button;
    doc.saveDrawState();
  }

  onPointerMove(doc, x, y, e) {
    if (!this._drawing) return;
    this._endX = x;
    this._endY = y;
    if (e.shiftKey) {
      // Constrain to 45-degree angles
      const dx = this._endX - this._startX;
      const dy = this._endY - this._startY;
      const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const dist = Math.sqrt(dx * dx + dy * dy);
      this._endX = this._startX + Math.cos(angle) * dist;
      this._endY = this._startY + Math.sin(angle) * dist;
    }
  }

  onPointerUp(doc, x, y, e) {
    if (!this._drawing) return;
    this._drawing = false;
    const layer = doc.activeLayer;
    if (!layer || !layer.visible) return;
    const snap = doc.selection.active ? layer.getSnapshot() : null;
    const color = this._button === 2 ? bus._secondaryColor : bus._primaryColor;
    const ctx = layer.ctx;
    ctx.save();
    if (doc.selection.active) doc.selection.applyClip(ctx);
    ctx.globalAlpha = bus._brushAlpha;
    if (!bus._antiAlias) {
      ctx.fillStyle = color;
      const size = bus._brushSize;
      const r = Math.floor(size / 2);
      bresenhamLine(Math.round(this._startX), Math.round(this._startY),
                    Math.round(this._endX), Math.round(this._endY), (lx, ly) => {
        ctx.fillRect(lx - r, ly - r, size, size);
      });
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = bus._brushSize;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(Math.round(this._startX), Math.round(this._startY));
      ctx.lineTo(Math.round(this._endX), Math.round(this._endY));
      ctx.stroke();
    }
    ctx.restore();
    if (snap && doc.selection.active) doc.selection.maskLayer(layer, snap);
    layer_ctx_reset(layer);
    bus.emit('canvas:dirty');
  }

  onOverlay(ctx, doc) {
    if (!this._drawing) return;
    const color = this._button === 2 ? bus._secondaryColor : bus._primaryColor;
    ctx.globalAlpha = 0.7;
    if (!bus._antiAlias) {
      ctx.fillStyle = color;
      const z = doc.zoom;
      const size = bus._brushSize;
      const r = Math.floor(size / 2);
      bresenhamLine(Math.round(this._startX), Math.round(this._startY),
                    Math.round(this._endX), Math.round(this._endY), (lx, ly) => {
        ctx.fillRect((lx - r) * z + doc.panX, (ly - r) * z + doc.panY, size * z, size * z);
      });
    } else {
      const sx = Math.round(this._startX), sy = Math.round(this._startY);
      const ex = Math.round(this._endX), ey = Math.round(this._endY);
      ctx.strokeStyle = color;
      ctx.lineWidth = bus._brushSize * doc.zoom;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sx * doc.zoom + doc.panX, sy * doc.zoom + doc.panY);
      ctx.lineTo(ex * doc.zoom + doc.panX, ey * doc.zoom + doc.panY);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

// ===== Rectangle =====

export class RectangleTool extends Tool {
  constructor() {
    super('Rectangle', 'r');
    this._drawing = false;
  }

  onPointerDown(doc, x, y, e) {
    this._drawing = true;
    this._startX = x; this._startY = y;
    this._endX = x; this._endY = y;
    this._button = e.button;
    doc.saveDrawState();
  }

  onPointerMove(doc, x, y, e) {
    if (!this._drawing) return;
    this._endX = x; this._endY = y;
    if (e.shiftKey) {
      const dx = this._endX - this._startX;
      const dy = this._endY - this._startY;
      const size = Math.max(Math.abs(dx), Math.abs(dy));
      this._endX = this._startX + size * Math.sign(dx);
      this._endY = this._startY + size * Math.sign(dy);
    }
  }

  onPointerUp(doc) {
    if (!this._drawing) return;
    this._drawing = false;
    const layer = doc.activeLayer;
    if (!layer || !layer.visible) return;
    const snap = doc.selection.active ? layer.getSnapshot() : null;
    const color = this._button === 2 ? bus._secondaryColor : bus._primaryColor;
    const ctx = layer.ctx;
    ctx.save();
    if (doc.selection.active) doc.selection.applyClip(ctx);
    ctx.globalAlpha = bus._brushAlpha;
    let rx = Math.min(this._startX, this._endX);
    let ry = Math.min(this._startY, this._endY);
    let rw = Math.abs(this._endX - this._startX);
    let rh = Math.abs(this._endY - this._startY);
    if (!bus._antiAlias) {
      rx = Math.round(rx); ry = Math.round(ry);
      rw = Math.round(rw); rh = Math.round(rh);
    }
    if (bus._filled) {
      ctx.fillStyle = color;
      ctx.fillRect(rx, ry, rw, rh);
    } else if (!bus._antiAlias) {
      ctx.fillStyle = color;
      const lw = bus._brushSize;
      ctx.fillRect(rx, ry, rw, lw); // top
      ctx.fillRect(rx, ry + rh - lw, rw, lw); // bottom
      ctx.fillRect(rx, ry + lw, lw, rh - 2 * lw); // left
      ctx.fillRect(rx + rw - lw, ry + lw, lw, rh - 2 * lw); // right
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = bus._brushSize;
      ctx.strokeRect(rx, ry, rw, rh);
    }
    ctx.restore();
    if (snap && doc.selection.active) doc.selection.maskLayer(layer, snap);
    layer_ctx_reset(layer);
    bus.emit('canvas:dirty');
  }

  onOverlay(ctx, doc) {
    if (!this._drawing) return;
    const color = this._button === 2 ? bus._secondaryColor : bus._primaryColor;
    const z = doc.zoom;
    const rx = Math.round(Math.min(this._startX, this._endX)) * z + doc.panX;
    const ry = Math.round(Math.min(this._startY, this._endY)) * z + doc.panY;
    const rw = Math.round(Math.abs(this._endX - this._startX)) * z;
    const rh = Math.round(Math.abs(this._endY - this._startY)) * z;
    ctx.globalAlpha = 0.7;
    if (bus._filled) {
      ctx.fillStyle = color;
      ctx.fillRect(rx, ry, rw, rh);
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = bus._brushSize * z;
      ctx.strokeRect(rx, ry, rw, rh);
    }
    ctx.globalAlpha = 1;
  }
}

// ===== Ellipse =====

export class EllipseTool extends Tool {
  constructor() {
    super('Ellipse', 'o');
    this._drawing = false;
  }

  onPointerDown(doc, x, y, e) {
    this._drawing = true;
    this._startX = x; this._startY = y;
    this._endX = x; this._endY = y;
    this._button = e.button;
    doc.saveDrawState();
  }

  onPointerMove(doc, x, y, e) {
    if (!this._drawing) return;
    this._endX = x; this._endY = y;
    if (e.shiftKey) {
      const dx = this._endX - this._startX;
      const dy = this._endY - this._startY;
      const size = Math.max(Math.abs(dx), Math.abs(dy));
      this._endX = this._startX + size * Math.sign(dx);
      this._endY = this._startY + size * Math.sign(dy);
    }
  }

  onPointerUp(doc) {
    if (!this._drawing) return;
    this._drawing = false;
    const layer = doc.activeLayer;
    if (!layer || !layer.visible) return;
    const snap = doc.selection.active ? layer.getSnapshot() : null;
    const color = this._button === 2 ? bus._secondaryColor : bus._primaryColor;
    const ctx = layer.ctx;
    ctx.save();
    if (doc.selection.active) doc.selection.applyClip(ctx);
    const cx = (this._startX + this._endX) / 2;
    const cy = (this._startY + this._endY) / 2;
    const rx = Math.abs(this._endX - this._startX) / 2;
    const ry = Math.abs(this._endY - this._startY) / 2;
    ctx.globalAlpha = bus._brushAlpha;
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(rx, 0.5), Math.max(ry, 0.5), 0, 0, Math.PI * 2);
    if (bus._filled) {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = bus._brushSize;
      ctx.stroke();
    }
    ctx.restore();
    if (snap && doc.selection.active) doc.selection.maskLayer(layer, snap);
    layer_ctx_reset(layer);
    bus.emit('canvas:dirty');
  }

  onOverlay(ctx, doc) {
    if (!this._drawing) return;
    const color = this._button === 2 ? bus._secondaryColor : bus._primaryColor;
    const z = doc.zoom;
    const x0 = Math.round(this._startX), y0 = Math.round(this._startY);
    const x1 = Math.round(this._endX), y1 = Math.round(this._endY);
    const cx = ((x0 + x1) / 2) * z + doc.panX;
    const cy = ((y0 + y1) / 2) * z + doc.panY;
    const rx = (Math.abs(x1 - x0) / 2) * z;
    const ry = (Math.abs(y1 - y0) / 2) * z;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(rx, 0.5), Math.max(ry, 0.5), 0, 0, Math.PI * 2);
    if (bus._filled) {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = bus._brushSize * z;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

// ===== Text =====

export class TextTool extends Tool {
  constructor() {
    super('Text', 't');
    this._active = false;
    this._doc = null;
  }

  onPointerDown(doc, x, y, e) {
    if (this._active) {
      this._commit();
      return;
    }
    this._startX = x;
    this._startY = y;
    this._active = true;
    this._doc = doc;
    this._button = e.button;
    doc.saveDrawState();

    const container = document.getElementById('text-input-container');
    const input = document.getElementById('text-input');
    container.classList.remove('hidden');
    container.style.left = (x * doc.zoom + doc.panX) + 'px';
    container.style.top = (y * doc.zoom + doc.panY) + 'px';
    input.style.fontSize = bus._fontSize + 'px';
    input.style.fontFamily = bus._fontFamily;
    const color = e.button === 2 ? bus._secondaryColor : bus._primaryColor;
    input.style.color = color;
    input.value = '';
    input.focus();
  }

  _commit() {
    const doc = this._doc;
    if (!doc) return;
    const input = document.getElementById('text-input');
    const text = input.value;
    const container = document.getElementById('text-input-container');
    container.classList.add('hidden');
    this._active = false;

    if (!text.trim()) return;
    const layer = doc.activeLayer;
    if (!layer || !layer.visible) return;
    const snap = doc.selection.active ? layer.getSnapshot() : null;
    const color = this._button === 2 ? bus._secondaryColor : bus._primaryColor;
    const ctx = layer.ctx;
    ctx.save();
    if (doc.selection.active) doc.selection.applyClip(ctx);
    ctx.fillStyle = color;
    ctx.font = `${bus._fontSize}px ${bus._fontFamily}`;
    ctx.globalAlpha = bus._brushAlpha;
    ctx.textBaseline = 'top';
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], this._startX, this._startY + i * bus._fontSize * 1.2);
    }
    ctx.restore();
    if (snap && doc.selection.active) doc.selection.maskLayer(layer, snap);
    layer_ctx_reset(layer);
    bus.emit('canvas:dirty');
  }

  deactivate() {
    if (this._active) {
      this._commit();
    }
  }
}

// ===== Select Rect =====

export class SelectRectTool extends Tool {
  constructor() {
    super('Select', 's');
    this._drawing = false;   // creating a new selection
    this._resizing = false;  // dragging a handle to resize existing selection
    this._handle = null;     // which handle is being dragged
  }

  onPointerDown(doc, x, y, e) {
    // Check if clicking on a handle first
    const handle = doc.selection.active ? hitHandle(doc, doc.selection.bounds, x, y) : null;
    if (handle) {
      this._resizing = true;
      this._handle = handle;
      // Save original bounds for resize calculation
      const b = doc.selection.bounds;
      this._origBounds = { x: b.x, y: b.y, w: b.w, h: b.h };
      this._dragStartX = x;
      this._dragStartY = y;
      return;
    }

    // Otherwise start a new selection
    this._drawing = true;
    this._startX = x; this._startY = y;
    this._endX = x; this._endY = y;
  }

  onPointerMove(doc, x, y, e) {
    if (this._resizing) {
      const dx = x - this._dragStartX;
      const dy = y - this._dragStartY;
      const nb = applyHandleDrag(this._handle.id, this._origBounds, dx, dy);
      doc.selection.setRect(nb.x, nb.y, nb.w, nb.h);
      bus.emit('canvas:dirty');
      return;
    }

    if (!this._drawing) {
      // Hover: show resize cursor when over a handle
      const vp = document.getElementById('viewport');
      const handle = doc.selection.active ? hitHandle(doc, doc.selection.bounds, x, y) : null;
      vp.style.cursor = handle ? handle.cursor : 'crosshair';
      return;
    }
    this._endX = x; this._endY = y;
    const sx = Math.min(this._startX, this._endX);
    const sy = Math.min(this._startY, this._endY);
    const sw = Math.abs(this._endX - this._startX);
    const sh = Math.abs(this._endY - this._startY);
    doc.selection.setRect(sx, sy, sw, sh);
  }

  onPointerUp(doc, x, y, e) {
    if (this._resizing) {
      this._resizing = false;
      this._handle = null;
      bus.emit('canvas:dirty');
      return;
    }

    if (!this._drawing) return;
    this._drawing = false;
    const sx = Math.min(this._startX, this._endX);
    const sy = Math.min(this._startY, this._endY);
    const sw = Math.abs(this._endX - this._startX);
    const sh = Math.abs(this._endY - this._startY);
    if (sw < 2 && sh < 2) {
      doc.selection.clear();
    } else {
      doc.selection.setRect(sx, sy, sw, sh);
    }
    bus.emit('canvas:dirty');
  }

  deactivate() {
    document.getElementById('viewport').style.cursor = 'crosshair';
  }

  /** Draw resize handles on the overlay */
  onOverlay(ctx, doc) {
    if (!doc.selection.active || !doc.selection.bounds) return;
    drawHandles(ctx, doc, doc.selection.bounds);
  }
}

// ===== Magic Wand =====

export class MagicWandTool extends Tool {
  constructor() {
    super('Wand', 'w');
  }

  onPointerDown(doc, x, y, e) {
    doc.compositeAll();
    const imageData = doc.compositeCtx.getImageData(0, 0, doc.width, doc.height);
    const selectFn = bus._wandGlobal ? globalSelect : floodSelect;
    const result = selectFn(imageData, Math.floor(x), Math.floor(y), bus._tolerance);
    if (result) {
      doc.selection.setMask(result.mask, result.bounds);
    } else {
      doc.selection.clear();
    }
    bus.emit('canvas:dirty');
  }
}

// ===== Move =====

export class MoveTool extends Tool {
  constructor() {
    super('Move', 'm');
    this._active = false;   // has cut content into buffer
    this._dragging = false;  // currently dragging (move or handle-scale)
    this._handleDrag = null; // which handle is being dragged (null = move)
    this._buffer = null;
    this._startX = 0;
    this._startY = 0;
    // Current destination rect (doc coords)
    this._destX = 0;
    this._destY = 0;
    this._destW = 0;
    this._destH = 0;
    // Snapshot of dest rect at drag start (for handle resize)
    this._dragOrigBounds = null;
  }

  activate() {
    document.getElementById('viewport').style.cursor = 'move';
  }

  deactivate() {
    document.getElementById('viewport').style.cursor = 'crosshair';
    if (this._active) this._commit();
  }

  /** Get the current bounding box of the moved/scaled content */
  _getBounds() {
    return { x: this._destX, y: this._destY, w: this._destW, h: this._destH };
  }

  /** Cut content from the layer into the buffer */
  _cutContent(doc) {
    const layer = doc.activeLayer;
    if (!layer || !layer.visible) return false;
    doc.saveDrawState();

    const sel = doc.selection;
    if (sel.active && sel.bounds) {
      const { x: sx, y: sy, w: sw, h: sh } = sel.bounds;
      this._destX = sx; this._destY = sy;
      this._destW = sw; this._destH = sh;

      this._buffer = document.createElement('canvas');
      this._buffer.width = sw; this._buffer.height = sh;
      const bctx = this._buffer.getContext('2d');
      bctx.drawImage(layer.canvas, sx, sy, sw, sh, 0, 0, sw, sh);

      if (sel.mask) {
        const bufData = bctx.getImageData(0, 0, sw, sh);
        const layerData = layer.ctx.getImageData(sx, sy, sw, sh);
        const bd = bufData.data, ld = layerData.data;
        for (let row = 0; row < sh; row++) {
          for (let col = 0; col < sw; col++) {
            const pi = (row * sw + col) * 4;
            if (sel.isSelected(col + sx, row + sy)) {
              ld[pi] = 0; ld[pi+1] = 0; ld[pi+2] = 0; ld[pi+3] = 0;
            } else {
              bd[pi] = 0; bd[pi+1] = 0; bd[pi+2] = 0; bd[pi+3] = 0;
            }
          }
        }
        bctx.putImageData(bufData, 0, 0);
        layer.ctx.putImageData(layerData, sx, sy);
      } else {
        layer.ctx.clearRect(sx, sy, sw, sh);
      }
    } else {
      this._destX = 0; this._destY = 0;
      this._destW = doc.width; this._destH = doc.height;
      this._buffer = document.createElement('canvas');
      this._buffer.width = doc.width; this._buffer.height = doc.height;
      this._buffer.getContext('2d').drawImage(layer.canvas, 0, 0);
      layer.clear();
    }
    this._active = true;
    bus.emit('canvas:dirty');
    return true;
  }

  /** Commit the buffer back to the layer */
  _commit() {
    if (!this._active || !this._buffer) return;
    const doc = bus._app?.doc;
    if (!doc) return;
    const layer = doc.activeLayer;
    const dx = Math.round(this._destX);
    const dy = Math.round(this._destY);
    const dw = Math.max(1, Math.round(this._destW));
    const dh = Math.max(1, Math.round(this._destH));

    const interp = bus._interpolation || 'nearest';
    layer.ctx.imageSmoothingEnabled = interp !== 'nearest';
    if (interp === 'bicubic') layer.ctx.imageSmoothingQuality = 'high';
    else layer.ctx.imageSmoothingQuality = 'low';
    layer.ctx.drawImage(this._buffer, dx, dy, dw, dh);
    layer.ctx.imageSmoothingEnabled = false;

    // Update selection to match
    if (doc.selection.active && doc.selection.bounds) {
      doc.selection.setRect(dx, dy, dw, dh);
    }

    this._buffer = null;
    this._active = false;
    bus.emit('canvas:dirty');
  }

  onPointerDown(doc, x, y, e) {
    // If we already have content in the buffer, check for handle or interior click
    if (this._active && this._buffer) {
      const bounds = this._getBounds();
      const handle = hitHandle(doc, bounds, x, y);
      if (handle) {
        // Start handle-based scale
        this._dragging = true;
        this._handleDrag = handle;
        this._startX = x; this._startY = y;
        this._dragOrigBounds = { ...bounds };
        return;
      }
      // Check if clicking inside the bounds (move)
      if (x >= bounds.x && x <= bounds.x + bounds.w &&
          y >= bounds.y && y <= bounds.y + bounds.h) {
        this._dragging = true;
        this._handleDrag = null;
        this._startX = x; this._startY = y;
        this._dragOrigBounds = { ...bounds };
        return;
      }
      // Clicked outside: commit current transform, then start fresh
      this._commit();
    }

    // Cut content and start move
    if (this._cutContent(doc)) {
      this._dragging = true;
      this._handleDrag = null;
      this._startX = x; this._startY = y;
      this._dragOrigBounds = { ...this._getBounds() };
    }
  }

  onPointerMove(doc, x, y, e) {
    if (!this._dragging) {
      // Hover cursor
      if (this._active) {
        const handle = hitHandle(doc, this._getBounds(), x, y);
        if (handle) {
          document.getElementById('viewport').style.cursor = handle.cursor;
          return;
        }
        const b = this._getBounds();
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
          document.getElementById('viewport').style.cursor = 'move';
          return;
        }
      }
      document.getElementById('viewport').style.cursor = 'move';
      return;
    }

    const dx = x - this._startX;
    const dy = y - this._startY;

    if (this._handleDrag) {
      // Handle-based scale
      const nb = applyHandleDrag(this._handleDrag.id, this._dragOrigBounds, dx, dy);
      this._destX = nb.x; this._destY = nb.y;
      this._destW = nb.w; this._destH = nb.h;
    } else {
      // Move
      let ox = dx, oy = dy;
      if (e.shiftKey) {
        if (Math.abs(ox) >= Math.abs(oy)) oy = 0;
        else ox = 0;
      }
      this._destX = this._dragOrigBounds.x + ox;
      this._destY = this._dragOrigBounds.y + oy;
    }
    bus.emit('canvas:dirty');
  }

  onPointerUp(doc, x, y, e) {
    if (!this._dragging) return;
    this._dragging = false;
    this._handleDrag = null;
    // Don't commit yet — keep handles visible for further adjustments
    bus.emit('canvas:dirty');
  }

  onOverlay(ctx, doc) {
    if (!this._active || !this._buffer) return;
    const z = doc.zoom;
    const dx = Math.round(this._destX) * z + doc.panX;
    const dy = Math.round(this._destY) * z + doc.panY;
    const dw = Math.max(1, Math.round(this._destW)) * z;
    const dh = Math.max(1, Math.round(this._destH)) * z;

    const interp = bus._interpolation || 'nearest';
    ctx.imageSmoothingEnabled = interp !== 'nearest';
    if (interp === 'bicubic') ctx.imageSmoothingQuality = 'high';
    else ctx.imageSmoothingQuality = 'low';
    ctx.globalAlpha = 0.7;
    ctx.drawImage(this._buffer, dx, dy, dw, dh);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1;

    // Bounding box outline
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.strokeRect(dx + 0.5, dy + 0.5, dw, dh);
    ctx.setLineDash([]);

    // Handles
    drawHandles(ctx, doc, this._getBounds());
  }
}

// ===== Rotate =====

export class RotateTool extends Tool {
  constructor() {
    super('Rotate', '');
    this._rotating = false;
    this._buffer = null;
    this._angle = 0;
    this._centerX = 0;
    this._centerY = 0;
    this._startAngle = 0;
    this._originX = 0;
    this._originY = 0;
    this._bufW = 0;
    this._bufH = 0;
  }

  activate() {
    document.getElementById('viewport').style.cursor = 'grab';
  }

  deactivate() {
    document.getElementById('viewport').style.cursor = 'crosshair';
    if (this._rotating) this._cancel();
  }

  _cancel() {
    this._rotating = false;
    this._buffer = null;
  }

  onPointerDown(doc, x, y, e) {
    const layer = doc.activeLayer;
    if (!layer || !layer.visible) return;
    doc.saveDrawState();
    this._rotating = true;
    this._angle = 0;

    const sel = doc.selection;
    if (sel.active && sel.bounds) {
      const { x: sx, y: sy, w: sw, h: sh } = sel.bounds;
      this._originX = sx;
      this._originY = sy;
      this._bufW = sw;
      this._bufH = sh;
      this._centerX = sx + sw / 2;
      this._centerY = sy + sh / 2;

      this._buffer = document.createElement('canvas');
      this._buffer.width = sw;
      this._buffer.height = sh;
      const bctx = this._buffer.getContext('2d');
      bctx.drawImage(layer.canvas, sx, sy, sw, sh, 0, 0, sw, sh);

      if (sel.mask) {
        const bufData = bctx.getImageData(0, 0, sw, sh);
        const layerData = layer.ctx.getImageData(sx, sy, sw, sh);
        const bd = bufData.data;
        const ld = layerData.data;
        for (let row = 0; row < sh; row++) {
          for (let col = 0; col < sw; col++) {
            const pi = (row * sw + col) * 4;
            if (sel.isSelected(col + sx, row + sy)) {
              ld[pi] = 0; ld[pi+1] = 0; ld[pi+2] = 0; ld[pi+3] = 0;
            } else {
              bd[pi] = 0; bd[pi+1] = 0; bd[pi+2] = 0; bd[pi+3] = 0;
            }
          }
        }
        bctx.putImageData(bufData, 0, 0);
        layer.ctx.putImageData(layerData, sx, sy);
      } else {
        layer.ctx.clearRect(sx, sy, sw, sh);
      }
    } else {
      this._originX = 0;
      this._originY = 0;
      this._bufW = doc.width;
      this._bufH = doc.height;
      this._centerX = doc.width / 2;
      this._centerY = doc.height / 2;

      this._buffer = document.createElement('canvas');
      this._buffer.width = doc.width;
      this._buffer.height = doc.height;
      this._buffer.getContext('2d').drawImage(layer.canvas, 0, 0);
      layer.clear();
    }

    this._startAngle = Math.atan2(y - this._centerY, x - this._centerX);
    bus.emit('canvas:dirty');
  }

  onPointerMove(doc, x, y, e) {
    if (!this._rotating) return;
    const cur = Math.atan2(y - this._centerY, x - this._centerX);
    this._angle = cur - this._startAngle;
    // Shift: snap to 45° increments
    if (e.shiftKey) {
      const snap = Math.PI / 4;
      this._angle = Math.round(this._angle / snap) * snap;
    }
    bus.emit('canvas:dirty');
  }

  onPointerUp(doc) {
    if (!this._rotating || !this._buffer) return;
    this._rotating = false;

    const layer = doc.activeLayer;
    const ctx = layer.ctx;
    ctx.save();
    ctx.translate(this._centerX, this._centerY);
    ctx.rotate(this._angle);
    ctx.drawImage(this._buffer, -this._bufW / 2, -this._bufH / 2);
    ctx.restore();

    // Clear selection since rotated content no longer matches the rect
    if (doc.selection.active) doc.selection.clear();

    this._buffer = null;
    bus.emit('canvas:dirty');
  }

  onOverlay(ctx, doc) {
    if (!this._rotating || !this._buffer) return;
    const z = doc.zoom;
    const cx = this._centerX * z + doc.panX;
    const cy = this._centerY * z + doc.panY;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this._angle);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 0.7;
    ctx.drawImage(this._buffer,
      -this._bufW * z / 2, -this._bufH * z / 2,
      this._bufW * z, this._bufH * z);
    ctx.restore();

    // Rotation center dot
    ctx.fillStyle = 'white';
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Angle readout
    const deg = Math.round(this._angle * 180 / Math.PI * 10) / 10;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(cx + 10, cy - 20, 52, 18);
    ctx.fillStyle = 'white';
    ctx.font = '11px sans-serif';
    ctx.fillText(deg + '°', cx + 14, cy - 7);

    ctx.globalAlpha = 1;
  }
}

// ===== Scale =====

export class ScaleTool extends Tool {
  constructor() {
    super('Scale', '');
    this._active = false;    // has cut content into buffer
    this._dragging = false;  // currently dragging a handle
    this._handleDrag = null; // which handle is being dragged
    this._buffer = null;
    this._startX = 0;
    this._startY = 0;
    // Current destination rect (doc coords)
    this._destX = 0;
    this._destY = 0;
    this._destW = 0;
    this._destH = 0;
    this._dragOrigBounds = null;
  }

  activate() {
    document.getElementById('viewport').style.cursor = 'nwse-resize';
  }

  deactivate() {
    document.getElementById('viewport').style.cursor = 'crosshair';
    if (this._active) this._commit();
  }

  _getBounds() {
    return { x: this._destX, y: this._destY, w: this._destW, h: this._destH };
  }

  /** Cut content from the layer into the buffer */
  _cutContent(doc) {
    const layer = doc.activeLayer;
    if (!layer || !layer.visible) return false;
    doc.saveDrawState();

    const sel = doc.selection;
    if (sel.active && sel.bounds) {
      const { x: sx, y: sy, w: sw, h: sh } = sel.bounds;
      this._destX = sx; this._destY = sy;
      this._destW = sw; this._destH = sh;

      this._buffer = document.createElement('canvas');
      this._buffer.width = sw; this._buffer.height = sh;
      const bctx = this._buffer.getContext('2d');
      bctx.drawImage(layer.canvas, sx, sy, sw, sh, 0, 0, sw, sh);

      if (sel.mask) {
        const bufData = bctx.getImageData(0, 0, sw, sh);
        const layerData = layer.ctx.getImageData(sx, sy, sw, sh);
        const bd = bufData.data, ld = layerData.data;
        for (let row = 0; row < sh; row++) {
          for (let col = 0; col < sw; col++) {
            const pi = (row * sw + col) * 4;
            if (sel.isSelected(col + sx, row + sy)) {
              ld[pi] = 0; ld[pi+1] = 0; ld[pi+2] = 0; ld[pi+3] = 0;
            } else {
              bd[pi] = 0; bd[pi+1] = 0; bd[pi+2] = 0; bd[pi+3] = 0;
            }
          }
        }
        bctx.putImageData(bufData, 0, 0);
        layer.ctx.putImageData(layerData, sx, sy);
      } else {
        layer.ctx.clearRect(sx, sy, sw, sh);
      }
    } else {
      this._destX = 0; this._destY = 0;
      this._destW = doc.width; this._destH = doc.height;
      this._buffer = document.createElement('canvas');
      this._buffer.width = doc.width; this._buffer.height = doc.height;
      this._buffer.getContext('2d').drawImage(layer.canvas, 0, 0);
      layer.clear();
    }
    this._active = true;
    bus.emit('canvas:dirty');
    return true;
  }

  /** Commit the buffer back to the layer */
  _commit() {
    if (!this._active || !this._buffer) return;
    const doc = bus._app?.doc;
    if (!doc) return;
    const layer = doc.activeLayer;
    const dx = Math.round(this._destX);
    const dy = Math.round(this._destY);
    const dw = Math.max(1, Math.round(this._destW));
    const dh = Math.max(1, Math.round(this._destH));

    const interp = bus._interpolation || 'nearest';
    layer.ctx.imageSmoothingEnabled = interp !== 'nearest';
    if (interp === 'bicubic') layer.ctx.imageSmoothingQuality = 'high';
    else layer.ctx.imageSmoothingQuality = 'low';
    layer.ctx.drawImage(this._buffer, dx, dy, dw, dh);
    layer.ctx.imageSmoothingEnabled = false;

    if (doc.selection.active && doc.selection.bounds) {
      doc.selection.setRect(dx, dy, dw, dh);
    }

    this._buffer = null;
    this._active = false;
    bus.emit('canvas:dirty');
  }

  onPointerDown(doc, x, y, e) {
    // If we already have content in the buffer, check for handle click
    if (this._active && this._buffer) {
      const bounds = this._getBounds();
      const handle = hitHandle(doc, bounds, x, y);
      if (handle) {
        this._dragging = true;
        this._handleDrag = handle;
        this._startX = x; this._startY = y;
        this._dragOrigBounds = { ...bounds };
        return;
      }
      // Clicked outside handles: commit current transform, then start fresh
      this._commit();
    }

    // Cut content and start with default SE handle drag
    if (this._cutContent(doc)) {
      this._dragging = true;
      // Default: drag from SE corner
      this._handleDrag = { id: 'se', cursor: 'nwse-resize' };
      this._startX = x; this._startY = y;
      this._dragOrigBounds = { ...this._getBounds() };
    }
  }

  onPointerMove(doc, x, y, e) {
    if (!this._dragging) {
      // Hover cursor
      if (this._active) {
        const handle = hitHandle(doc, this._getBounds(), x, y);
        document.getElementById('viewport').style.cursor = handle ? handle.cursor : 'nwse-resize';
      }
      return;
    }

    const dx = x - this._startX;
    const dy = y - this._startY;
    let nb = applyHandleDrag(this._handleDrag.id, this._dragOrigBounds, dx, dy);

    // Shift: constrain proportions
    if (e.shiftKey && this._dragOrigBounds.w > 0 && this._dragOrigBounds.h > 0) {
      const aspect = this._dragOrigBounds.w / this._dragOrigBounds.h;
      const hid = this._handleDrag.id;
      if (hid === 'n' || hid === 's') {
        nb.w = nb.h * aspect;
      } else if (hid === 'e' || hid === 'w') {
        nb.h = nb.w / aspect;
      } else {
        // Corner: use the larger scale factor
        const sx = nb.w / this._dragOrigBounds.w;
        const sy = nb.h / this._dragOrigBounds.h;
        const s = Math.max(sx, sy);
        nb.w = this._dragOrigBounds.w * s;
        nb.h = this._dragOrigBounds.h * s;
      }
    }

    this._destX = nb.x; this._destY = nb.y;
    this._destW = nb.w; this._destH = nb.h;
    bus.emit('canvas:dirty');
  }

  onPointerUp(doc, x, y, e) {
    if (!this._dragging) return;
    this._dragging = false;
    this._handleDrag = null;
    // Don't commit yet — keep handles visible for further adjustments
    bus.emit('canvas:dirty');
  }

  onOverlay(ctx, doc) {
    if (!this._active || !this._buffer) return;
    const z = doc.zoom;
    const dx = Math.round(this._destX) * z + doc.panX;
    const dy = Math.round(this._destY) * z + doc.panY;
    const dw = Math.max(1, Math.round(this._destW)) * z;
    const dh = Math.max(1, Math.round(this._destH)) * z;

    const interp = bus._interpolation || 'nearest';
    ctx.imageSmoothingEnabled = interp !== 'nearest';
    if (interp === 'bicubic') ctx.imageSmoothingQuality = 'high';
    else ctx.imageSmoothingQuality = 'low';
    ctx.globalAlpha = 0.7;
    ctx.drawImage(this._buffer, dx, dy, dw, dh);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1;

    // Bounding box outline
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.strokeRect(dx + 0.5, dy + 0.5, dw, dh);
    ctx.setLineDash([]);

    // Handles
    drawHandles(ctx, doc, this._getBounds());

    // Size readout
    const nw = Math.max(1, Math.round(this._destW));
    const nh = Math.max(1, Math.round(this._destH));
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(dx + dw + 4, dy - 2, 80, 18);
    ctx.fillStyle = 'white';
    ctx.font = '11px sans-serif';
    ctx.fillText(`${nw} x ${nh}`, dx + dw + 8, dy + 11);
  }
}

// ===== Mirror =====

export class MirrorTool extends Tool {
  constructor() {
    super('Mirror', '');
  }

  onPointerDown(doc, x, y, e) {
    if (e.button === 2) {
      bus.emit('flip:vertical');
    } else {
      bus.emit('flip:horizontal');
    }
  }
}

// ===== Helper to reset layer ctx =====

function layer_ctx_reset(layer) {
  if (!layer) return;
  layer.ctx.globalAlpha = 1;
  layer.ctx.globalCompositeOperation = 'source-over';
}

// ===== Tool Manager =====

export class ToolManager {
  constructor() {
    this.tools = {};
    this.activeTool = null;
    this._toolName = null;

    // Register tools
    const all = [
      new PencilTool(), new BrushTool(), new EraserTool(),
      new FillTool(), new EyedropperTool(), new LineTool(),
      new RectangleTool(), new EllipseTool(), new TextTool(),
      new SelectRectTool(), new MagicWandTool(),
      new MoveTool(), new RotateTool(), new ScaleTool(), new MirrorTool(),
    ];
    for (const t of all) this.tools[t.name.toLowerCase()] = t;

    // Tool name to key mapping for toolbox buttons
    this._keyMap = {};
    for (const t of all) this._keyMap[t.key] = t.name.toLowerCase();

    this.setTool('pencil');

    bus.on('tool:set', name => this.setTool(name));
    bus.on('tool:set-by-key', key => {
      // S cycles between selection tools
      if (key === 's' && (this._toolName === 'select' || this._toolName === 'wand')) {
        this.setTool(this._toolName === 'select' ? 'wand' : 'select');
        return;
      }
      const name = this._keyMap[key];
      if (name) this.setTool(name);
    });
    bus.on('render:tool-overlay', (ctx, doc) => {
      if (this.activeTool) this.activeTool.onOverlay(ctx, doc);
    });
  }

  setTool(name) {
    if (this.activeTool) this.activeTool.deactivate();
    this._toolName = name;
    this.activeTool = this.tools[name] || null;
    if (this.activeTool) this.activeTool.activate();
    bus.emit('tool:changed', name);

    // Update toolbox UI
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === name);
    });
    document.getElementById('status-tool').textContent =
      this.activeTool ? this.activeTool.name : '';
  }

  getOptions() {
    return this.activeTool ? this.activeTool.getOptions() : [];
  }
}
