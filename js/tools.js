// ===== GrobPaint Tools + ToolManager =====

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

/** Draw a pixel-accurate brush cursor on the overlay.
 *  Shows the exact pixels that would be painted, outlined in white+black for visibility. */
function drawBrushCursor(ctx, doc, screenX, screenY) {
  const z = doc.zoom;
  const { x: docX, y: docY } = doc.screenToDoc(screenX, screenY);
  const cx = Math.floor(docX), cy = Math.floor(docY);
  const size = bus._brushSize;
  const rad = size / 2;
  const ri = Math.ceil(rad);

  // Build a set of filled pixels
  const pixels = [];
  for (let dy = -ri; dy <= ri; dy++) {
    for (let dx = -ri; dx <= ri; dx++) {
      if (bus._antiAlias || dx * dx + dy * dy <= rad * rad) {
        // For AA mode, approximate the circle with same pixel test
        if (!bus._antiAlias || dx * dx + dy * dy <= rad * rad) {
          pixels.push(cx + dx, cy + dy);
        }
      }
    }
  }

  // Build outline: for each pixel, draw edges that border a non-filled pixel
  const filled = new Set();
  for (let i = 0; i < pixels.length; i += 2) {
    filled.add(pixels[i] + ',' + pixels[i + 1]);
  }

  ctx.beginPath();
  for (let i = 0; i < pixels.length; i += 2) {
    const px = pixels[i], py = pixels[i + 1];
    const sx = px * z + doc.panX, sy = py * z + doc.panY;
    // Top edge
    if (!filled.has(px + ',' + (py - 1))) { ctx.moveTo(sx, sy); ctx.lineTo(sx + z, sy); }
    // Bottom edge
    if (!filled.has(px + ',' + (py + 1))) { ctx.moveTo(sx, sy + z); ctx.lineTo(sx + z, sy + z); }
    // Left edge
    if (!filled.has((px - 1) + ',' + py)) { ctx.moveTo(sx, sy); ctx.lineTo(sx, sy + z); }
    // Right edge
    if (!filled.has((px + 1) + ',' + py)) { ctx.moveTo(sx + z, sy); ctx.lineTo(sx + z, sy + z); }
  }

  // Draw twice: black then white offset for visibility on any background
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.setLineDash([2, 2]);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Get the CSS resize cursor for a handle ID, accounting for rotation */
function handleCursor(id, rotation) {
  // Base angles for each handle (degrees from north, clockwise)
  const baseAngles = { n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315 };
  const cursors = ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'];
  const base = baseAngles[id] || 0;
  const deg = ((base + rotation * 180 / Math.PI) % 360 + 360) % 360;
  // Snap to nearest 45-degree sector, map to one of 4 cursor types
  const idx = Math.round(deg / 45) % 4;
  return cursors[idx];
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
      const cx = Math.floor(x), cy = Math.floor(y);
      const rad = size / 2;
      const ri = Math.ceil(rad);
      for (let dy = -ri; dy <= ri; dy++) {
        for (let dx = -ri; dx <= ri; dx++) {
          if (dx * dx + dy * dy <= rad * rad) {
            ctx.fillRect(cx + dx, cy + dy, 1, 1);
          }
        }
      }
    }
    ctx.restore();
  }

  onOverlay(ctx, doc) {
    if (!this._drawing) {
      const vp = document.getElementById('viewport');
      const r = vp.getBoundingClientRect();
      const mx = bus._mouseX - r.left;
      const my = bus._mouseY - r.top;
      if (mx >= 0 && my >= 0) drawBrushCursor(ctx, doc, mx, my);
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
      const cx = Math.floor(x), cy = Math.floor(y);
      const rad = size / 2;
      const ri = Math.ceil(rad);
      for (let dy = -ri; dy <= ri; dy++) {
        for (let dx = -ri; dx <= ri; dx++) {
          if (dx * dx + dy * dy <= rad * rad) {
            ctx.fillRect(cx + dx, cy + dy, 1, 1);
          }
        }
      }
    }
    ctx.restore();
  }

  onOverlay(ctx, doc) {
    const vp = document.getElementById('viewport');
    const r = vp.getBoundingClientRect();
    const mx = bus._mouseX - r.left;
    const my = bus._mouseY - r.top;
    if (mx >= 0 && my >= 0) drawBrushCursor(ctx, doc, mx, my);
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
    const layer = doc.activeLayer;
    if (!layer || !layer.visible) return;
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
    const layer = doc.activeLayer;
    if (!layer || !layer.visible) return;
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
    const layer = doc.activeLayer;
    if (!layer || !layer.visible) return;
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
    const layer = doc.activeLayer;
    if (!layer || !layer.visible) return;
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
      doc.saveSelectionState();
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
    doc.saveSelectionState();
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
    this._lastX = -1;
    this._lastY = -1;
    this._imageData = null; // cached composite for live tolerance updates
    bus.on('wand:reselect', () => this._reselect());
  }

  activate() {
    this._lastX = -1;
    this._lastY = -1;
    this._imageData = null;
  }

  deactivate() {
    this._imageData = null;
  }

  onPointerDown(doc, x, y, e) {
    doc.saveSelectionState();
    doc.compositeAll();
    this._imageData = doc.compositeCtx.getImageData(0, 0, doc.width, doc.height);
    this._lastX = Math.floor(x);
    this._lastY = Math.floor(y);
    const selectFn = bus._wandGlobal ? globalSelect : floodSelect;
    const result = selectFn(this._imageData, this._lastX, this._lastY, bus._tolerance);
    if (result) {
      doc.selection.setMask(result.mask, result.bounds);
    } else {
      doc.selection.clear();
    }
    bus.emit('canvas:dirty');
  }

  /** Re-run selection with current tolerance (called when slider changes) */
  _reselect() {
    const doc = bus._app?.doc;
    if (!doc || this._lastX < 0 || !this._imageData) return;
    const selectFn = bus._wandGlobal ? globalSelect : floodSelect;
    const result = selectFn(this._imageData, this._lastX, this._lastY, bus._tolerance);
    if (result) {
      doc.selection.setMask(result.mask, result.bounds);
    } else {
      doc.selection.clear();
    }
    bus.emit('canvas:dirty');
  }
}

// ===== Lasso Select =====

export class LassoTool extends Tool {
  constructor() {
    super('Lasso', '');
    this._drawing = false;
    this._points = [];
  }

  onPointerDown(doc, x, y, e) {
    doc.saveSelectionState();
    this._drawing = true;
    this._points = [{ x: Math.floor(x), y: Math.floor(y) }];
  }

  onPointerMove(doc, x, y, e) {
    if (!this._drawing) return;
    const last = this._points[this._points.length - 1];
    const px = Math.floor(x), py = Math.floor(y);
    if (Math.abs(px - last.x) > 1 || Math.abs(py - last.y) > 1) {
      this._points.push({ x: px, y: py });
      bus.emit('canvas:dirty');
    }
  }

  onPointerUp(doc) {
    if (!this._drawing) return;
    this._drawing = false;
    if (this._points.length < 3) { this._points = []; return; }
    // Rasterize polygon to selection mask using canvas fill
    const c = document.createElement('canvas');
    c.width = doc.width; c.height = doc.height;
    const ctx = c.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(this._points[0].x, this._points[0].y);
    for (let i = 1; i < this._points.length; i++) {
      ctx.lineTo(this._points[i].x, this._points[i].y);
    }
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.fill();
    const id = ctx.getImageData(0, 0, doc.width, doc.height);
    const mask = new Uint8Array(doc.width * doc.height);
    let minX = doc.width, maxX = 0, minY = doc.height, maxY = 0;
    let found = false;
    for (let i = 0; i < mask.length; i++) {
      if (id.data[i * 4 + 3] > 0) {
        mask[i] = 1;
        const x = i % doc.width, y = Math.floor(i / doc.width);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        found = true;
      }
    }
    if (found) {
      doc.selection.setMask(mask, { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
    } else {
      doc.selection.clear();
    }
    this._points = [];
    bus.emit('canvas:dirty');
  }

  onOverlay(ctx, doc) {
    if (!this._drawing || this._points.length < 2) return;
    const z = doc.zoom;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this._points[0].x * z + doc.panX, this._points[0].y * z + doc.panY);
    for (let i = 1; i < this._points.length; i++) {
      ctx.lineTo(this._points[i].x * z + doc.panX, this._points[i].y * z + doc.panY);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // Draw closing line to start
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    const last = this._points[this._points.length - 1];
    ctx.moveTo(last.x * z + doc.panX, last.y * z + doc.panY);
    ctx.lineTo(this._points[0].x * z + doc.panX, this._points[0].y * z + doc.panY);
    ctx.stroke();
  }
}

// ===== Move Pixels (M) =====

export class MovePixelsTool extends Tool {
  constructor() {
    super('Move', 'm');
    this._active = false;
    this._buffer = null;
    this._bufferW = 0;
    this._bufferH = 0;
    this._sourceLayer = null; // layer the content was cut from
    // Transform state (center-based)
    this._tx = 0; this._ty = 0;
    this._scaleX = 1; this._scaleY = 1;
    this._rotation = 0;
    // Drag state
    this._dragging = false;
    this._dragMode = null; // 'move' | 'handle' | 'rotate'
    this._dragHandle = null;
    this._dragStartX = 0; this._dragStartY = 0;
    this._dragStartTx = 0; this._dragStartTy = 0;
    this._dragStartScaleX = 0; this._dragStartScaleY = 0;
    this._dragStartRotation = 0;
    this._dragStartAngle = 0;
  }

  activate() { document.getElementById('viewport').style.cursor = 'move'; }
  deactivate() {
    document.getElementById('viewport').style.cursor = 'crosshair';
    if (this._active) this.commit();
  }

  _getCorners() {
    const hw = this._bufferW / 2 * this._scaleX;
    const hh = this._bufferH / 2 * this._scaleY;
    const cos = Math.cos(this._rotation), sin = Math.sin(this._rotation);
    return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([lx, ly]) => ({
      x: this._tx + lx * cos - ly * sin,
      y: this._ty + lx * sin + ly * cos,
    }));
  }

  _getHandles() {
    const hw = this._bufferW / 2 * this._scaleX;
    const hh = this._bufferH / 2 * this._scaleY;
    const cos = Math.cos(this._rotation), sin = Math.sin(this._rotation);
    const pts = [
      { id: 'nw', lx: -hw, ly: -hh }, { id: 'n', lx: 0, ly: -hh },
      { id: 'ne', lx: hw, ly: -hh },  { id: 'e', lx: hw, ly: 0 },
      { id: 'se', lx: hw, ly: hh },   { id: 's', lx: 0, ly: hh },
      { id: 'sw', lx: -hw, ly: hh },  { id: 'w', lx: -hw, ly: 0 },
    ];
    return pts.map(p => ({
      id: p.id,
      x: this._tx + p.lx * cos - p.ly * sin,
      y: this._ty + p.lx * sin + p.ly * cos,
    }));
  }

  _getRotationHandle(zoom) {
    const hh = this._bufferH / 2 * this._scaleY;
    const cos = Math.cos(this._rotation), sin = Math.sin(this._rotation);
    const topX = this._tx + hh * sin;
    const topY = this._ty - hh * cos;
    const offset = 25 / zoom;
    return { x: topX + sin * offset, y: topY - cos * offset };
  }

  _isInsideBounds(x, y) {
    const dx = x - this._tx, dy = y - this._ty;
    const cos = Math.cos(-this._rotation), sin = Math.sin(-this._rotation);
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;
    return Math.abs(lx) <= this._bufferW / 2 * this._scaleX &&
           Math.abs(ly) <= this._bufferH / 2 * this._scaleY;
  }

  _hitTest(doc, x, y) {
    const z = doc.zoom;
    const threshold = 7;
    const smx = x * z + doc.panX, smy = y * z + doc.panY;
    // Rotation handle
    const rh = this._getRotationHandle(z);
    const rhx = rh.x * z + doc.panX, rhy = rh.y * z + doc.panY;
    if (Math.hypot(smx - rhx, smy - rhy) < threshold) return { mode: 'rotate' };
    // Resize handles
    for (const h of this._getHandles()) {
      const sx = h.x * z + doc.panX, sy = h.y * z + doc.panY;
      if (Math.abs(smx - sx) < threshold && Math.abs(smy - sy) < threshold)
        return { mode: 'handle', handle: h };
    }
    // Interior
    if (this._isInsideBounds(x, y)) return { mode: 'move' };
    return null;
  }

  _cutContent(doc) {
    const layer = doc.activeLayer;
    if (!layer || !layer.visible) return false;
    doc.saveDrawState();
    const sel = doc.selection;
    let sx, sy, sw, sh;

    if (sel.active && sel.bounds) {
      ({ x: sx, y: sy, w: sw, h: sh } = sel.bounds);
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
      sx = 0; sy = 0; sw = doc.width; sh = doc.height;
      this._buffer = document.createElement('canvas');
      this._buffer.width = sw; this._buffer.height = sh;
      this._buffer.getContext('2d').drawImage(layer.canvas, 0, 0);
      layer.clear();
    }

    this._bufferW = sw; this._bufferH = sh;
    this._tx = sx + sw / 2; this._ty = sy + sh / 2;
    this._scaleX = 1; this._scaleY = 1; this._rotation = 0;
    this._sourceLayer = layer;
    this._active = true;
    bus.emit('canvas:dirty');
    return true;
  }

  commit() {
    if (!this._active || !this._buffer) return;
    const doc = bus._app?.doc;
    if (!doc) return;
    // Commit back to the layer the content was cut from, not current active
    const layer = this._sourceLayer || doc.activeLayer;
    const ctx = layer.ctx;
    const interp = bus._interpolation || 'nearest';
    ctx.imageSmoothingEnabled = interp !== 'nearest';
    if (interp === 'bicubic') ctx.imageSmoothingQuality = 'high';
    else ctx.imageSmoothingQuality = 'low';
    ctx.save();
    ctx.translate(this._tx, this._ty);
    ctx.rotate(this._rotation);
    ctx.scale(this._scaleX, this._scaleY);
    ctx.drawImage(this._buffer, -this._bufferW / 2, -this._bufferH / 2);
    ctx.restore();
    ctx.imageSmoothingEnabled = false;
    // Update selection to AABB of transformed content
    if (doc.selection.active) {
      const corners = this._getCorners();
      const xs = corners.map(c => c.x), ys = corners.map(c => c.y);
      doc.selection.setRect(
        Math.floor(Math.min(...xs)), Math.floor(Math.min(...ys)),
        Math.ceil(Math.max(...xs)) - Math.floor(Math.min(...xs)),
        Math.ceil(Math.max(...ys)) - Math.floor(Math.min(...ys)));
    }
    this._buffer = null; this._active = false; this._sourceLayer = null;
    bus.emit('canvas:dirty');
  }

  cancel() {
    if (!this._active) return;
    this._active = false; this._buffer = null; this._dragging = false; this._sourceLayer = null;
    const doc = bus._app?.doc;
    if (doc) doc.undo();
    bus.emit('canvas:dirty');
  }

  onPointerDown(doc, x, y, e) {
    if (this._active && this._buffer) {
      const hit = this._hitTest(doc, x, y);
      if (hit) {
        this._dragging = true;
        this._dragMode = hit.mode;
        this._dragHandle = hit.handle || null;
        this._dragStartX = x; this._dragStartY = y;
        this._dragStartTx = this._tx; this._dragStartTy = this._ty;
        this._dragStartScaleX = this._scaleX; this._dragStartScaleY = this._scaleY;
        this._dragStartRotation = this._rotation;
        if (hit.mode === 'rotate') {
          this._dragStartAngle = Math.atan2(y - this._ty, x - this._tx);
        }
        return;
      }
      // Clicked outside: commit and start fresh
      this.commit();
    }
    // Determine drag mode from where user clicked on the preview handles
    const previewHit = this._hitTestSelection(doc, x, y);
    if (this._cutContent(doc)) {
      this._dragging = true;
      this._dragStartX = x; this._dragStartY = y;
      this._dragStartTx = this._tx; this._dragStartTy = this._ty;
      this._dragStartScaleX = this._scaleX; this._dragStartScaleY = this._scaleY;
      this._dragStartRotation = this._rotation;
      if (previewHit && previewHit.mode === 'handle') {
        this._dragMode = 'handle';
        this._dragHandle = previewHit.handle;
      } else if (previewHit && previewHit.mode === 'rotate') {
        this._dragMode = 'rotate';
        this._dragHandle = null;
        this._dragStartAngle = Math.atan2(y - this._ty, x - this._tx);
      } else {
        this._dragMode = 'move';
        this._dragHandle = null;
      }
    }
  }

  /** Get preview bounds from selection (before buffer is cut) */
  _previewFromSelection(doc) {
    const sel = doc.selection;
    if (sel.active && sel.bounds) return sel.bounds;
    return { x: 0, y: 0, w: doc.width, h: doc.height };
  }

  /** Hit-test against selection bounds (before buffer is cut) */
  _hitTestSelection(doc, x, y) {
    const b = this._previewFromSelection(doc);
    const z = doc.zoom, threshold = 7;
    const smx = x * z + doc.panX, smy = y * z + doc.panY;
    const topCx = b.x + b.w / 2, topCy = b.y;
    const offset = 25 / z;
    const rhx = topCx, rhy = topCy - offset;
    if (Math.hypot(smx - (rhx * z + doc.panX), smy - (rhy * z + doc.panY)) < threshold)
      return { mode: 'rotate' };
    const handles = getHandles(b);
    for (const h of handles) {
      const sx = h.x * z + doc.panX, sy = h.y * z + doc.panY;
      if (Math.abs(smx - sx) < threshold && Math.abs(smy - sy) < threshold)
        return { mode: 'handle', handle: h };
    }
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)
      return { mode: 'move' };
    return null;
  }

  onPointerMove(doc, x, y, e) {
    if (!this._dragging) {
      const vp = document.getElementById('viewport');
      if (this._active) {
        const hit = this._hitTest(doc, x, y);
        if (!hit) vp.style.cursor = 'move';
        else if (hit.mode === 'rotate') vp.style.cursor = 'grab';
        else if (hit.mode === 'move') vp.style.cursor = 'move';
        else vp.style.cursor = handleCursor(hit.handle.id, this._rotation);
      } else {
        const hit = this._hitTestSelection(doc, x, y);
        if (!hit) vp.style.cursor = 'move';
        else if (hit.mode === 'rotate') vp.style.cursor = 'grab';
        else if (hit.mode === 'move') vp.style.cursor = 'move';
        else vp.style.cursor = handleCursor(hit.handle.id, 0);
      }
      return;
    }
    const mdx = x - this._dragStartX, mdy = y - this._dragStartY;
    if (this._dragMode === 'move') {
      let ox = mdx, oy = mdy;
      if (e.shiftKey) {
        // Snap to nearest 45-degree direction
        const angle = Math.atan2(oy, ox);
        const snap = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
        const dist = Math.sqrt(ox * ox + oy * oy);
        ox = dist * Math.cos(snap);
        oy = dist * Math.sin(snap);
      }
      this._tx = Math.round(this._dragStartTx + ox);
      this._ty = Math.round(this._dragStartTy + oy);
    } else if (this._dragMode === 'rotate') {
      const cur = Math.atan2(y - this._ty, x - this._tx);
      this._rotation = this._dragStartRotation + (cur - this._dragStartAngle);
      if (e.shiftKey) {
        const snap = Math.PI / 12; // 15 degrees
        this._rotation = Math.round(this._rotation / snap) * snap;
      }
    } else if (this._dragMode === 'handle') {
      const cos = Math.cos(this._rotation), sin = Math.sin(this._rotation);
      const ldx = mdx * cos + mdy * sin;
      const ldy = -mdx * sin + mdy * cos;
      const hw = this._bufferW / 2 * this._dragStartScaleX;
      const hh = this._bufferH / 2 * this._dragStartScaleY;
      let newLeft = -hw, newRight = hw, newTop = -hh, newBottom = hh;
      const hid = this._dragHandle.id;
      if (hid.includes('e')) newRight += ldx;
      if (hid.includes('w')) newLeft += ldx;
      if (hid.includes('s')) newBottom += ldy;
      if (hid.includes('n')) newTop += ldy;
      let newW = newRight - newLeft, newH = newBottom - newTop;
      // Shift: proportional resize anchored to opposite corner/edge
      // Use proportions at drag start, not original buffer proportions
      if (e.shiftKey && this._bufferW > 0 && this._bufferH > 0) {
        const aspect = (this._dragStartScaleX * this._bufferW) / (this._dragStartScaleY * this._bufferH);
        if (hid === 'n' || hid === 's') {
          newW = Math.abs(newH) * aspect;
          const anchorY = hid === 'n' ? newBottom : newTop;
          newLeft = -newW / 2; newRight = newW / 2;
          if (hid === 'n') { newTop = anchorY - newH; newBottom = anchorY; }
          else { newBottom = anchorY + newH; newTop = anchorY; }
        } else if (hid === 'e' || hid === 'w') {
          newH = Math.abs(newW) / aspect;
          const anchorX = hid === 'e' ? newLeft : newRight;
          newTop = -newH / 2; newBottom = newH / 2;
          if (hid === 'e') { newRight = anchorX + newW; newLeft = anchorX; }
          else { newLeft = anchorX - newW; newRight = anchorX; }
        } else {
          // Corner: uniform scale relative to current size, anchor opposite corner
          const curW = this._bufferW * this._dragStartScaleX;
          const curH = this._bufferH * this._dragStartScaleY;
          const sx = Math.abs(newW) / curW;
          const sy = Math.abs(newH) / curH;
          const s = Math.max(sx, sy);
          newW = curW * s * Math.sign(newW || 1);
          newH = curH * s * Math.sign(newH || 1);
          // Anchor the opposite corner
          const anchorX = hid.includes('e') ? newLeft : newRight;
          const anchorY = hid.includes('s') ? newTop : newBottom;
          if (hid.includes('e')) { newRight = anchorX + newW; newLeft = anchorX; }
          else { newLeft = anchorX - Math.abs(newW); newRight = anchorX; }
          if (hid.includes('s')) { newBottom = anchorY + newH; newTop = anchorY; }
          else { newTop = anchorY - Math.abs(newH); newBottom = anchorY; }
        }
      }
      this._scaleX = Math.max(0.01, Math.abs(newW) / this._bufferW);
      this._scaleY = Math.max(0.01, Math.abs(newH) / this._bufferH);
      const localCenterX = (newLeft + newRight) / 2;
      const localCenterY = (newTop + newBottom) / 2;
      this._tx = this._dragStartTx + localCenterX * cos - localCenterY * sin;
      this._ty = this._dragStartTy + localCenterX * sin + localCenterY * cos;
    }
    if (this._active) this._syncSelection(doc);
    bus.emit('canvas:dirty');
  }

  /** Update doc.selection to match the current transform AABB */
  _syncSelection(doc) {
    if (!doc.selection.active) return;
    const corners = this._getCorners();
    const xs = corners.map(c => c.x), ys = corners.map(c => c.y);
    const minX = Math.floor(Math.min(...xs));
    const minY = Math.floor(Math.min(...ys));
    const maxX = Math.ceil(Math.max(...xs));
    const maxY = Math.ceil(Math.max(...ys));
    doc.selection.setRect(
      Math.max(0, minX), Math.max(0, minY),
      Math.min(doc.width, maxX) - Math.max(0, minX),
      Math.min(doc.height, maxY) - Math.max(0, minY));
  }

  onPointerUp(doc) {
    if (!this._dragging) return;
    this._dragging = false;
    this._dragMode = null; this._dragHandle = null;
    if (this._active) this._syncSelection(doc);
    bus.emit('canvas:dirty');
  }

  onOverlay(ctx, doc) {
    if (!this._active || !this._buffer) {
      // Preview: show handles around selection or full canvas
      const b = this._previewFromSelection(doc);
      if (b.w > 0 && b.h > 0) {
        const z = doc.zoom;
        drawHandles(ctx, doc, b);
        // Rotation handle
        const topCx = b.x + b.w / 2, topCy = b.y;
        const offset = 25 / z;
        const rhx = topCx * z + doc.panX, rhy = (topCy - offset) * z + doc.panY;
        const thx = topCx * z + doc.panX, thy = topCy * z + doc.panY;
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(thx, thy); ctx.lineTo(rhx, rhy); ctx.stroke();
        ctx.fillStyle = 'white'; ctx.strokeStyle = '#333';
        ctx.beginPath(); ctx.arc(rhx, rhy, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      return;
    }
    const z = doc.zoom;
    // Draw floating buffer
    ctx.save();
    ctx.translate(this._tx * z + doc.panX, this._ty * z + doc.panY);
    ctx.rotate(this._rotation);
    ctx.scale(this._scaleX, this._scaleY);
    const interp = bus._interpolation || 'nearest';
    ctx.imageSmoothingEnabled = interp !== 'nearest';
    if (interp === 'bicubic') ctx.imageSmoothingQuality = 'high';
    else ctx.imageSmoothingQuality = 'low';
    ctx.globalAlpha = this._dragging ? 0.7 : 1;
    ctx.drawImage(this._buffer,
      -this._bufferW * z / 2, -this._bufferH * z / 2,
      this._bufferW * z, this._bufferH * z);
    ctx.restore();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1;
    // Bounding outline
    const corners = this._getCorners();
    const sc = corners.map(c => ({ x: c.x * z + doc.panX, y: c.y * z + doc.panY }));
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sc[0].x, sc[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(sc[i].x, sc[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    // Resize handles
    const handles = this._getHandles();
    const hSize = 5;
    ctx.fillStyle = 'white'; ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
    for (const h of handles) {
      const sx = Math.round(h.x * z + doc.panX), sy = Math.round(h.y * z + doc.panY);
      ctx.fillRect(sx - hSize, sy - hSize, hSize * 2, hSize * 2);
      ctx.strokeRect(sx - hSize, sy - hSize, hSize * 2, hSize * 2);
    }
    // Rotation handle + line
    const rh = this._getRotationHandle(z);
    const rhx = rh.x * z + doc.panX, rhy = rh.y * z + doc.panY;
    const topH = handles.find(h => h.id === 'n');
    const thx = topH.x * z + doc.panX, thy = topH.y * z + doc.panY;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(thx, thy); ctx.lineTo(rhx, rhy); ctx.stroke();
    ctx.fillStyle = 'white'; ctx.strokeStyle = '#333';
    ctx.beginPath(); ctx.arc(rhx, rhy, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // Angle readout while rotating
    if (this._dragging && this._dragMode === 'rotate') {
      const deg = Math.round(this._rotation * 180 / Math.PI * 10) / 10;
      const cx = this._tx * z + doc.panX, cy = this._ty * z + doc.panY;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(cx + 10, cy - 20, 52, 18);
      ctx.fillStyle = 'white'; ctx.font = '11px sans-serif';
      ctx.fillText(deg + '\u00B0', cx + 14, cy - 7);
    }
    // Size readout while resizing
    if (this._dragging && this._dragMode === 'handle') {
      const nw = Math.max(1, Math.round(this._bufferW * this._scaleX));
      const nh = Math.max(1, Math.round(this._bufferH * this._scaleY));
      const maxSx = Math.max(...sc.map(c => c.x));
      const minSy = Math.min(...sc.map(c => c.y));
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(maxSx + 4, minSy - 2, 80, 18);
      ctx.fillStyle = 'white'; ctx.font = '11px sans-serif';
      ctx.fillText(`${nw} x ${nh}`, maxSx + 8, minSy + 11);
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
      new SelectRectTool(), new MagicWandTool(), new LassoTool(),
      new MovePixelsTool(),
    ];
    for (const t of all) this.tools[t.name.toLowerCase()] = t;

    // Tool name to key mapping for toolbox buttons
    this._keyMap = {};
    for (const t of all) if (t.key) this._keyMap[t.key] = t.name.toLowerCase();

    this.setTool('pencil');

    bus.on('tool:set', name => this.setTool(name));
    bus.on('tool:set-by-key', key => {
      // S cycles between selection tools
      if (key === 's' && ['select', 'wand', 'lasso'].includes(this._toolName)) {
        const cycle = ['select', 'wand', 'lasso'];
        this.setTool(cycle[(cycle.indexOf(this._toolName) + 1) % cycle.length]);
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
