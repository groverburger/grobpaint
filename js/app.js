// ===== GrobPaint App — initialization, events, keyboard shortcuts, file I/O =====

import { bus } from './core.js';
import { Renderer } from './renderer.js';
import { ToolManager } from './tools.js';
import { ColorSystem, LayersPanel, DocManager, ToolOptionsBar, MenuBar, NewImageDialog, CanvasSizeDialog, ScaleImageDialog } from './ui.js';

class App {
  constructor() {
    // Mouse state for tool overlays
    bus._mouseX = 0;
    bus._mouseY = 0;

    // Init subsystems
    this.renderer = new Renderer();
    this.toolManager = new ToolManager();
    this.colorSystem = new ColorSystem();
    this.layersPanel = new LayersPanel();
    this.docManager = new DocManager();
    this.toolOptions = new ToolOptionsBar();
    this.menuBar = new MenuBar(this);
    this.newDialog = new NewImageDialog();
    this.canvasSizeDialog = new CanvasSizeDialog();
    this.scaleImageDialog = new ScaleImageDialog();

    // Create initial document
    this.docManager.createDoc(1280, 720, 'Untitled', 'white');

    // Wire up canvas events
    this._initCanvasEvents();
    this._initKeyboard();
    this._initToolbox();
    this._initClipboard();
    this._initGrid();

    // Flip events
    bus.on('flip:horizontal', () => this.flipHorizontal());
    bus.on('flip:vertical', () => this.flipVertical());

    // Context menu prevention
    document.addEventListener('contextmenu', e => {
      if (e.target.closest('#viewport')) e.preventDefault();
      if (e.target.closest('#palette')) e.preventDefault();
    });
  }

  get doc() { return this.docManager.activeDoc; }

  // ===== Canvas pointer events =====

  _initCanvasEvents() {
    const vp = document.getElementById('viewport');
    const mainCanvas = document.getElementById('canvas-main');
    let panning = false;
    let panStartX = 0, panStartY = 0;
    let spaceHeld = false;

    // Track space key for pan mode
    document.addEventListener('keydown', e => {
      if (e.code === 'Space' && !e.repeat && !e.target.closest('input, textarea, [contenteditable]')) {
        spaceHeld = true;
        vp.style.cursor = 'grab';
      }
    });
    document.addEventListener('keyup', e => {
      if (e.code === 'Space') {
        spaceHeld = false;
        if (!panning) vp.style.cursor = 'crosshair';
      }
    });

    mainCanvas.addEventListener('pointerdown', e => {
      const doc = this.doc;
      if (!doc) return;

      // Middle click or space+click = pan
      if (e.button === 1 || (spaceHeld && e.button === 0)) {
        panning = true;
        panStartX = e.clientX - doc.panX;
        panStartY = e.clientY - doc.panY;
        vp.style.cursor = 'grabbing';
        mainCanvas.setPointerCapture(e.pointerId);
        return;
      }

      const rect = vp.getBoundingClientRect();
      const { x, y } = doc.screenToDoc(e.clientX - rect.left, e.clientY - rect.top);
      this.toolManager.activeTool?.onPointerDown(doc, x, y, e);
      mainCanvas.setPointerCapture(e.pointerId);
    });

    mainCanvas.addEventListener('pointermove', e => {
      const doc = this.doc;
      if (!doc) return;

      bus._mouseX = e.clientX;
      bus._mouseY = e.clientY;

      if (panning) {
        doc.panX = e.clientX - panStartX;
        doc.panY = e.clientY - panStartY;
        bus.emit('canvas:dirty');
        return;
      }

      const rect = vp.getBoundingClientRect();
      const { x, y } = doc.screenToDoc(e.clientX - rect.left, e.clientY - rect.top);

      // Status bar coords
      document.getElementById('status-coords').textContent =
        `${Math.floor(x)}, ${Math.floor(y)}`;

      this.toolManager.activeTool?.onPointerMove(doc, x, y, e);
    });

    mainCanvas.addEventListener('pointerup', e => {
      const doc = this.doc;
      if (!doc) return;

      if (panning) {
        panning = false;
        vp.style.cursor = spaceHeld ? 'grab' : 'crosshair';
        return;
      }

      const rect = vp.getBoundingClientRect();
      const { x, y } = doc.screenToDoc(e.clientX - rect.left, e.clientY - rect.top);
      this.toolManager.activeTool?.onPointerUp(doc, x, y, e);
    });

    // Zoom with wheel
    mainCanvas.addEventListener('wheel', e => {
      e.preventDefault();
      const doc = this.doc;
      if (!doc) return;

      const rect = vp.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const newZoom = Math.max(0.05, Math.min(32, doc.zoom * factor));

      // Zoom toward mouse position
      doc.panX = mx - (mx - doc.panX) * (newZoom / doc.zoom);
      doc.panY = my - (my - doc.panY) * (newZoom / doc.zoom);
      doc.zoom = newZoom;

      document.getElementById('status-zoom').textContent = Math.round(doc.zoom * 100) + '%';
      bus.emit('canvas:dirty');
    }, { passive: false });
  }

  // ===== Toolbox buttons =====

  _initToolbox() {
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        bus.emit('tool:set', btn.dataset.tool);
      });
    });
  }

  // ===== Keyboard shortcuts =====

  _initKeyboard() {
    document.addEventListener('keydown', e => {
      // Don't handle shortcuts when typing in inputs
      if (e.target.closest('input, textarea, [contenteditable]')) return;

      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      const key = e.key.toLowerCase();

      // Ctrl shortcuts
      if (ctrl) {
        switch (key) {
          case 'n': e.preventDefault(); this.showNewDialog(); return;
          case 'o': e.preventDefault(); this.openFile(); return;
          case 's':
            e.preventDefault();
            if (shift) this.saveFileAs();
            else this.saveFile();
            return;
          case 'z':
            e.preventDefault();
            if (shift) this.redo();
            else this.undo();
            return;
          case 'v': return; // let native paste event handle it
          case 'a': e.preventDefault(); this.selectAll(); return;
          case 'd': e.preventDefault(); this.deselect(); return;
          case 'g': e.preventDefault(); bus.emit('grid:toggle'); return;
          case 'w': e.preventDefault(); bus.emit('doc:close'); return;
          case '0': e.preventDefault(); this.fitInView(); return;
          case '1': e.preventDefault(); this.actualSize(); return;
        }
        return;
      }

      // Tool hotkeys
      const toolKeys = 'pbefiltroswm';
      if (toolKeys.includes(key)) {
        e.preventDefault();
        bus.emit('tool:set-by-key', key);
        return;
      }

      // Other shortcuts
      switch (key) {
        case 'x': e.preventDefault(); this.colorSystem.swap(); break;
        case '[':
          e.preventDefault();
          bus._brushSize = Math.max(1, bus._brushSize - 1);
          this.toolOptions.render(this.toolManager._toolName);
          break;
        case ']':
          e.preventDefault();
          bus._brushSize = Math.min(200, bus._brushSize + 1);
          this.toolOptions.render(this.toolManager._toolName);
          break;
        case '=': case '+': e.preventDefault(); this.zoomIn(); break;
        case '-': e.preventDefault(); this.zoomOut(); break;
        case 'delete': case 'backspace':
          e.preventDefault();
          this._deleteSelection();
          break;
      }
    });
  }

  // ===== Clipboard =====

  _initClipboard() {
    document.addEventListener('paste', e => {
      if (e.target.closest('input, textarea, [contenteditable]')) return;
      // Try clipboardData.items first (Chrome, Edge)
      const items = e.clipboardData?.items;
      if (items) {
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            e.preventDefault();
            const blob = item.getAsFile();
            if (blob) { this._pasteImageBlob(blob); return; }
          }
        }
      }
      // Fallback: clipboardData.files (Firefox, Safari)
      const files = e.clipboardData?.files;
      if (files) {
        for (const file of files) {
          if (file.type.startsWith('image/')) {
            e.preventDefault();
            this._pasteImageBlob(file);
            return;
          }
        }
      }
    });
  }

  _initGrid() {
    const toggle = document.getElementById('grid-toggle');
    const sizeX = document.getElementById('grid-size-x');
    const sizeY = document.getElementById('grid-size-y');

    toggle.addEventListener('change', () => {
      this.renderer.gridEnabled = toggle.checked;
      this.renderer.markDirty();
    });

    const updateSize = () => {
      const x = Math.max(1, parseInt(sizeX.value) || 16);
      const y = Math.max(1, parseInt(sizeY.value) || 16);
      bus.emit('grid:set-size', x, y);
    };
    sizeX.addEventListener('change', updateSize);
    sizeY.addEventListener('change', updateSize);

    // Sync checkbox when toggled via shortcut/menu
    bus.on('grid:toggle', () => {
      toggle.checked = this.renderer.gridEnabled;
    });
  }

  async pasteFromClipboard() {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find(t => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          this._pasteImageBlob(blob);
          return;
        }
      }
    } catch {
      // Clipboard API may not be available; fall through silently
    }
  }

  _pasteImageBlob(blob) {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      // Store dimensions for new image dialog
      bus._lastClipboardSize = { width: img.width, height: img.height };
      const doc = this.doc;
      if (doc) {
        // Paste as new layer in current document
        doc.saveStructureState();
        const layer = doc.addLayer('Pasted');
        layer.ctx.drawImage(img, 0, 0);
        bus.emit('layers:changed');
        bus.emit('canvas:dirty');
      } else {
        // No document open — create one from the image
        bus.emit('doc:new', img.width, img.height, 'Pasted', 'transparent');
        // Wait for doc to be created, then draw
        setTimeout(() => {
          const newDoc = this.doc;
          if (newDoc) {
            newDoc.activeLayer.ctx.drawImage(img, 0, 0);
            bus.emit('canvas:dirty');
          }
          URL.revokeObjectURL(url);
        }, 50);
        return;
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  /** Try to read clipboard image dimensions. Returns {width, height} or null. */
  static async getClipboardImageSize() {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find(t => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          return new Promise(resolve => {
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
              resolve({ width: img.width, height: img.height });
              URL.revokeObjectURL(url);
            };
            img.onerror = () => {
              resolve(null);
              URL.revokeObjectURL(url);
            };
            img.src = url;
          });
        }
      }
    } catch {}
    return null;
  }

  // ===== Actions =====

  showNewDialog() { this.newDialog.show(); }

  undo() {
    if (!this.doc) return;
    if (this.doc.undo()) {
      bus.emit('canvas:dirty');
      bus.emit('layers:changed');
    }
  }

  redo() {
    if (!this.doc) return;
    if (this.doc.redo()) {
      bus.emit('canvas:dirty');
      bus.emit('layers:changed');
    }
  }

  selectAll() {
    if (!this.doc) return;
    this.doc.selection.setRect(0, 0, this.doc.width, this.doc.height);
    bus.emit('canvas:dirty');
  }

  deselect() {
    if (!this.doc) return;
    this.doc.selection.clear();
    bus.emit('canvas:dirty');
  }

  _deleteSelection() {
    const doc = this.doc;
    if (!doc || !doc.selection.active) return;
    doc.saveDrawState();
    const layer = doc.activeLayer;
    const sel = doc.selection;
    if (sel.bounds) {
      const { x, y, w, h } = sel.bounds;
      if (sel.mask) {
        const imageData = layer.ctx.getImageData(0, 0, doc.width, doc.height);
        for (let row = y; row < y + h && row < doc.height; row++) {
          for (let col = x; col < x + w && col < doc.width; col++) {
            if (sel.mask[row * doc.width + col]) {
              const idx = (row * doc.width + col) * 4;
              imageData.data[idx] = 0;
              imageData.data[idx + 1] = 0;
              imageData.data[idx + 2] = 0;
              imageData.data[idx + 3] = 0;
            }
          }
        }
        layer.ctx.putImageData(imageData, 0, 0);
      } else {
        layer.ctx.clearRect(x, y, w, h);
      }
    }
    bus.emit('canvas:dirty');
  }

  flattenImage() {
    const doc = this.doc;
    if (!doc || doc.layers.length <= 1) return;
    doc.saveStructureState();
    doc.compositeAll();
    // Replace all layers with single flattened layer
    const layer = doc.layers[0];
    layer.clear();
    layer.ctx.drawImage(doc.composite, 0, 0);
    layer.name = 'Background';
    layer.opacity = 1;
    layer.visible = true;
    layer.blendMode = 'source-over';
    doc.layers = [layer];
    doc.activeLayerIndex = 0;
    bus.emit('layers:changed');
    bus.emit('canvas:dirty');
  }

  cropToSelection() {
    const doc = this.doc;
    if (!doc || !doc.selection.active || !doc.selection.bounds) return;
    doc.saveStructureState();
    doc.cropToSelection();
    bus.emit('layers:changed');
    bus.emit('canvas:dirty');
    document.getElementById('status-size').textContent = `${doc.width} x ${doc.height}`;
    // Re-fit in viewport
    const vp = document.getElementById('viewport').getBoundingClientRect();
    doc.fitInView(vp.width, vp.height);
    document.getElementById('status-zoom').textContent = Math.round(doc.zoom * 100) + '%';
  }

  showScaleImageDialog() {
    if (!this.doc) return;
    this.scaleImageDialog.show(this.doc);
  }

  showCanvasSizeDialog() {
    if (!this.doc) return;
    this.canvasSizeDialog.show(this.doc);
  }

  zoomIn() {
    if (!this.doc) return;
    const vp = document.getElementById('viewport').getBoundingClientRect();
    const cx = vp.width / 2, cy = vp.height / 2;
    const factor = 1.25;
    const newZoom = Math.min(32, this.doc.zoom * factor);
    this.doc.panX = cx - (cx - this.doc.panX) * (newZoom / this.doc.zoom);
    this.doc.panY = cy - (cy - this.doc.panY) * (newZoom / this.doc.zoom);
    this.doc.zoom = newZoom;
    document.getElementById('status-zoom').textContent = Math.round(this.doc.zoom * 100) + '%';
    bus.emit('canvas:dirty');
  }

  zoomOut() {
    if (!this.doc) return;
    const vp = document.getElementById('viewport').getBoundingClientRect();
    const cx = vp.width / 2, cy = vp.height / 2;
    const factor = 1 / 1.25;
    const newZoom = Math.max(0.05, this.doc.zoom * factor);
    this.doc.panX = cx - (cx - this.doc.panX) * (newZoom / this.doc.zoom);
    this.doc.panY = cy - (cy - this.doc.panY) * (newZoom / this.doc.zoom);
    this.doc.zoom = newZoom;
    document.getElementById('status-zoom').textContent = Math.round(this.doc.zoom * 100) + '%';
    bus.emit('canvas:dirty');
  }

  fitInView() {
    if (!this.doc) return;
    const vp = document.getElementById('viewport').getBoundingClientRect();
    this.doc.fitInView(vp.width, vp.height);
    document.getElementById('status-zoom').textContent = Math.round(this.doc.zoom * 100) + '%';
    bus.emit('canvas:dirty');
  }

  actualSize() {
    if (!this.doc) return;
    const vp = document.getElementById('viewport').getBoundingClientRect();
    const oldZoom = this.doc.zoom;
    this.doc.zoom = 1;
    this.doc.panX = (vp.width - this.doc.width) / 2;
    this.doc.panY = (vp.height - this.doc.height) / 2;
    document.getElementById('status-zoom').textContent = '100%';
    bus.emit('canvas:dirty');
  }

  // ===== Flip / Mirror =====

  flipHorizontal() {
    const doc = this.doc;
    if (!doc) return;
    const layer = doc.activeLayer;
    if (!layer || !layer.visible) return;
    doc.saveDrawState();
    const sel = doc.selection;
    if (sel.active && sel.bounds) {
      const { x, y, w, h } = sel.bounds;
      const temp = document.createElement('canvas');
      temp.width = w; temp.height = h;
      const tctx = temp.getContext('2d');
      tctx.drawImage(layer.canvas, x, y, w, h, 0, 0, w, h);
      layer.ctx.clearRect(x, y, w, h);
      layer.ctx.save();
      layer.ctx.translate(x + w, y);
      layer.ctx.scale(-1, 1);
      layer.ctx.drawImage(temp, 0, 0);
      layer.ctx.restore();
    } else {
      const temp = document.createElement('canvas');
      temp.width = doc.width; temp.height = doc.height;
      temp.getContext('2d').drawImage(layer.canvas, 0, 0);
      layer.clear();
      layer.ctx.save();
      layer.ctx.translate(doc.width, 0);
      layer.ctx.scale(-1, 1);
      layer.ctx.drawImage(temp, 0, 0);
      layer.ctx.restore();
    }
    bus.emit('canvas:dirty');
  }

  flipVertical() {
    const doc = this.doc;
    if (!doc) return;
    const layer = doc.activeLayer;
    if (!layer || !layer.visible) return;
    doc.saveDrawState();
    const sel = doc.selection;
    if (sel.active && sel.bounds) {
      const { x, y, w, h } = sel.bounds;
      const temp = document.createElement('canvas');
      temp.width = w; temp.height = h;
      const tctx = temp.getContext('2d');
      tctx.drawImage(layer.canvas, x, y, w, h, 0, 0, w, h);
      layer.ctx.clearRect(x, y, w, h);
      layer.ctx.save();
      layer.ctx.translate(x, y + h);
      layer.ctx.scale(1, -1);
      layer.ctx.drawImage(temp, 0, 0);
      layer.ctx.restore();
    } else {
      const temp = document.createElement('canvas');
      temp.width = doc.width; temp.height = doc.height;
      temp.getContext('2d').drawImage(layer.canvas, 0, 0);
      layer.clear();
      layer.ctx.save();
      layer.ctx.translate(0, doc.height);
      layer.ctx.scale(1, -1);
      layer.ctx.drawImage(temp, 0, 0);
      layer.ctx.restore();
    }
    bus.emit('canvas:dirty');
  }

  // ===== File I/O =====

  async openFile() {
    try {
      const resp = await fetch('/api/file/open', { method: 'POST' });
      const data = await resp.json();
      if (data.cancelled) return;
      if (data.error) { alert('Error: ' + data.error); return; }

      if (data.name?.endsWith('.gbp')) {
        // Redirect to project open
        this.openProject();
        return;
      }
      bus.emit('doc:open-image', data.data, data.name);
    } catch (e) {
      alert('Error opening file: ' + e.message);
    }
  }

  async saveFile() {
    const doc = this.doc;
    if (!doc) return;
    doc.compositeAll();
    const dataUrl = doc.composite.toDataURL('image/png');
    try {
      const resp = await fetch('/api/file/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: dataUrl, path: doc.path, ext: '.png', defaultName: doc.name }),
      });
      const result = await resp.json();
      if (result.cancelled) return;
      if (result.error) { alert('Error: ' + result.error); return; }
      doc.path = result.path;
      doc.name = result.name;
      doc.dirty = false;
      this.docManager.renderTabs();
    } catch (e) {
      alert('Error saving file: ' + e.message);
    }
  }

  async saveFileAs() {
    const doc = this.doc;
    if (!doc) return;
    const origPath = doc.path;
    doc.path = null; // Force dialog
    await this.saveFile();
    if (!doc.path) doc.path = origPath; // Restore if cancelled
  }

  async saveProject() {
    const doc = this.doc;
    if (!doc) return;

    const manifest = {
      version: 1,
      width: doc.width,
      height: doc.height,
      layers: doc.layers.map((l, i) => ({
        name: l.name,
        file: `layer_${i}.png`,
        opacity: l.opacity,
        visible: l.visible,
        blendMode: l.blendMode,
      })),
    };

    const layers = doc.layers.map((l, i) => ({
      file: `layer_${i}.png`,
      data: l.toDataURL(),
    }));

    try {
      const resp = await fetch('/api/project/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          manifest,
          layers,
          path: doc.projectPath,
          defaultName: doc.name,
        }),
      });
      const result = await resp.json();
      if (result.cancelled) return;
      if (result.error) { alert('Error: ' + result.error); return; }
      doc.projectPath = result.path;
      doc.name = result.name;
      doc.dirty = false;
      this.docManager.renderTabs();
    } catch (e) {
      alert('Error saving project: ' + e.message);
    }
  }

  async openProject() {
    try {
      const resp = await fetch('/api/project/open', { method: 'POST' });
      const data = await resp.json();
      if (data.cancelled) return;
      if (data.error) { alert('Error: ' + data.error); return; }
      bus.emit('doc:open-project', data);
    } catch (e) {
      alert('Error opening project: ' + e.message);
    }
  }
}

// ===== Start =====
window.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
