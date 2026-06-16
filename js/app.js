// ===== GrobPaint App — initialization, events, keyboard shortcuts, file I/O =====

import { bus, Selection } from './core.js';
import { Renderer } from './renderer.js';
import { ToolManager } from './tools.js';
import { ColorSystem, LayersPanel, HistoryPanel, DocManager, ToolOptionsBar, MenuBar, NewImageDialog, CanvasSizeDialog, ScaleImageDialog, BrightnessContrastDialog, HSLAdjustDialog, GaussianBlurDialog, SharpenDialog, PosterizeDialog, ThresholdDialog } from './ui.js';

class App {
  constructor() {
    // Make app accessible to tools for commit-on-deactivate
    bus._app = this;

    // Mouse state for tool overlays
    bus._mouseX = 0;
    bus._mouseY = 0;

    // Init subsystems
    this.renderer = new Renderer();
    this.toolManager = new ToolManager();
    this.colorSystem = new ColorSystem();
    this.layersPanel = new LayersPanel();
    this.historyPanel = new HistoryPanel();
    this.docManager = new DocManager();
    this.toolOptions = new ToolOptionsBar();
    this.menuBar = new MenuBar(this);
    this.newDialog = new NewImageDialog();
    this.canvasSizeDialog = new CanvasSizeDialog();
    this.scaleImageDialog = new ScaleImageDialog();
    this.bcDialog = new BrightnessContrastDialog();
    this.hslDialog = new HSLAdjustDialog();
    this.blurDialog = new GaussianBlurDialog();
    this.sharpenDialog = new SharpenDialog();
    this.posterizeDialog = new PosterizeDialog();
    this.thresholdDialog = new ThresholdDialog();

    // Restore from localStorage or create initial document
    if (!this.docManager.restoreFromStorage()) {
      this.docManager.createDoc(1280, 720, 'Untitled', 'white');
    }

    // Wire up canvas events
    this._initCanvasEvents();
    this._initKeyboard();
    this._initToolbox();
    this._initClipboard();
    this._initGrid();
    this._initZoom();
    this._initSelectionStatus();

    // Eagerly detect server availability so file dialogs work on first click
    this._hasServer();

    // Re-fit after first layout (viewport may have 0 size during constructor)
    requestAnimationFrame(() => {
      if (this.doc) this.fitInView();
    });

    // Flip/rotate events
    bus.on('flip:horizontal', () => this.flipHorizontal());
    bus.on('flip:vertical', () => this.flipVertical());
    bus.on('rotate:cw', () => this.rotateCW());
    bus.on('rotate:ccw', () => this.rotateCCW());
    bus.on('rotate:180', () => this.rotate180());

    // Context menu prevention
    document.addEventListener('contextmenu', e => {
      if (e.target.closest('#viewport')) e.preventDefault();
      if (e.target.closest('#palette')) e.preventDefault();
    });

    // Save state before unload
    window.addEventListener('beforeunload', () => {
      this.docManager.saveToStorage();
    });
  }

  get doc() { return this.docManager.activeDoc; }

  // ===== Canvas pointer events =====

  _initCanvasEvents() {
    const vp = document.getElementById('viewport');
    const mainCanvas = document.getElementById('canvas-main');
    let spaceHeld = false;

    // Exclusive pan (space+click): blocks tool events entirely
    let spacePanning = false;
    let spacePanStartX = 0, spacePanStartY = 0;
    let spacePanPointerId = null;

    // Concurrent middle-click pan: runs alongside tool events
    let middlePanning = false;
    let middlePanStartX = 0, middlePanStartY = 0;
    let middlePanPointerId = null;

    // Tool drag state for auto-pan
    let toolDragging = false;
    let toolPointerId = null;
    let lastClientX = 0, lastClientY = 0;
    let autoPanTimer = null;
    const AUTO_PAN_EDGE = 30; // pixels from edge to start auto-pan
    const AUTO_PAN_SPEED = 8; // pixels per frame

    const stopAutoPan = () => {
      if (autoPanTimer) { cancelAnimationFrame(autoPanTimer); autoPanTimer = null; }
    };

    const tickAutoPan = () => {
      autoPanTimer = null;
      const doc = this.doc;
      if (!doc || !toolDragging) return;
      const rect = vp.getBoundingClientRect();
      const cx = lastClientX - rect.left;
      const cy = lastClientY - rect.top;
      let dx = 0, dy = 0;
      if (cx < AUTO_PAN_EDGE) dx = AUTO_PAN_SPEED;
      else if (cx > rect.width - AUTO_PAN_EDGE) dx = -AUTO_PAN_SPEED;
      if (cy < AUTO_PAN_EDGE) dy = AUTO_PAN_SPEED;
      else if (cy > rect.height - AUTO_PAN_EDGE) dy = -AUTO_PAN_SPEED;
      if (dx || dy) {
        doc.panX += dx;
        doc.panY += dy;
        // Re-dispatch tool move with updated coords
        const { x, y } = doc.screenToDoc(cx, cy);
        document.getElementById('status-coords').textContent =
          `${Math.floor(x)}, ${Math.floor(y)}`;
        this.toolManager.activeTool?.onPointerMove(doc, x, y, { button: 0 });
        bus.emit('canvas:dirty');
        autoPanTimer = requestAnimationFrame(tickAutoPan);
      }
    };

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
        if (!spacePanning) vp.style.cursor = 'crosshair';
      }
    });

    mainCanvas.addEventListener('pointerdown', e => {
      const doc = this.doc;
      if (!doc) return;

      // Space+left-click = exclusive pan (blocks tool)
      if (spaceHeld && e.button === 0) {
        spacePanning = true;
        spacePanStartX = e.clientX - doc.panX;
        spacePanStartY = e.clientY - doc.panY;
        spacePanPointerId = e.pointerId;
        vp.style.cursor = 'grabbing';
        mainCanvas.setPointerCapture(e.pointerId);
        return;
      }

      // Middle-click = concurrent pan (doesn't block tool)
      if (e.button === 1) {
        middlePanning = true;
        middlePanStartX = e.clientX - doc.panX;
        middlePanStartY = e.clientY - doc.panY;
        middlePanPointerId = e.pointerId;
        mainCanvas.setPointerCapture(e.pointerId);
        return;
      }

      // Left-click = tool
      if (e.button === 0 || e.button === 2) {
        const rect = vp.getBoundingClientRect();
        const { x, y } = doc.screenToDoc(e.clientX - rect.left, e.clientY - rect.top);
        this.toolManager.activeTool?.onPointerDown(doc, x, y, e);
        toolDragging = true;
        toolPointerId = e.pointerId;
        lastClientX = e.clientX;
        lastClientY = e.clientY;
        mainCanvas.setPointerCapture(e.pointerId);
      }
    });

    mainCanvas.addEventListener('pointermove', e => {
      const doc = this.doc;
      if (!doc) return;

      bus._mouseX = e.clientX;
      bus._mouseY = e.clientY;

      // Space pan
      if (spacePanning && e.pointerId === spacePanPointerId) {
        doc.panX = e.clientX - spacePanStartX;
        doc.panY = e.clientY - spacePanStartY;
        bus.emit('canvas:dirty');
        return;
      }

      // Middle-click pan (concurrent — runs alongside tool)
      if (middlePanning && e.pointerId === middlePanPointerId) {
        doc.panX = e.clientX - middlePanStartX;
        doc.panY = e.clientY - middlePanStartY;
        bus.emit('canvas:dirty');
        // Also update tool position since viewport shifted under cursor
        if (toolDragging) {
          const rect = vp.getBoundingClientRect();
          const cx = lastClientX - rect.left;
          const cy = lastClientY - rect.top;
          const { x, y } = doc.screenToDoc(cx, cy);
          this.toolManager.activeTool?.onPointerMove(doc, x, y, { button: 0 });
        }
        return;
      }

      // Tool move
      if (e.pointerId === toolPointerId || !toolDragging) {
        const rect = vp.getBoundingClientRect();
        const { x, y } = doc.screenToDoc(e.clientX - rect.left, e.clientY - rect.top);

        document.getElementById('status-coords').textContent =
          `${Math.floor(x)}, ${Math.floor(y)}`;

        this.toolManager.activeTool?.onPointerMove(doc, x, y, e);

        // Auto-pan: track mouse position for edge detection
        if (toolDragging) {
          lastClientX = e.clientX;
          lastClientY = e.clientY;
          const cx = e.clientX - rect.left;
          const cy = e.clientY - rect.top;
          const nearEdge = cx < AUTO_PAN_EDGE || cx > rect.width - AUTO_PAN_EDGE ||
                           cy < AUTO_PAN_EDGE || cy > rect.height - AUTO_PAN_EDGE;
          if (nearEdge && !autoPanTimer) {
            autoPanTimer = requestAnimationFrame(tickAutoPan);
          } else if (!nearEdge) {
            stopAutoPan();
          }
        }
      }
    });

    mainCanvas.addEventListener('pointerup', e => {
      const doc = this.doc;
      if (!doc) return;

      // Space pan end
      if (spacePanning && e.pointerId === spacePanPointerId) {
        spacePanning = false;
        spacePanPointerId = null;
        vp.style.cursor = spaceHeld ? 'grab' : 'crosshair';
        return;
      }

      // Middle-click pan end
      if (middlePanning && e.pointerId === middlePanPointerId) {
        middlePanning = false;
        middlePanPointerId = null;
        // Don't return — tool up may also need to fire
      }

      // Tool up
      if (toolDragging && e.pointerId === toolPointerId) {
        toolDragging = false;
        toolPointerId = null;
        stopAutoPan();
        const rect = vp.getBoundingClientRect();
        const { x, y } = doc.screenToDoc(e.clientX - rect.left, e.clientY - rect.top);
        this.toolManager.activeTool?.onPointerUp(doc, x, y, e);
      }
    });

    // Wheel: zoom (pinch or scroll-wheel) and pan (two-finger trackpad scroll)
    mainCanvas.addEventListener('wheel', e => {
      e.preventDefault();
      const doc = this.doc;
      if (!doc) return;

      const rect = vp.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (e.ctrlKey) {
        // Pinch-to-zoom (trackpad) or Ctrl+scroll wheel
        // Clamp deltaY so discrete wheel steps don't zoom too aggressively
        const clamped = Math.max(-3, Math.min(3, e.deltaY));
        const factor = Math.exp(-clamped * 0.1);
        const newZoom = Math.max(0.05, Math.min(32, doc.zoom * factor));
        doc.panX = mx - (mx - doc.panX) * (newZoom / doc.zoom);
        doc.panY = my - (my - doc.panY) * (newZoom / doc.zoom);
        doc.zoom = newZoom;
        this._syncZoomUI();
        bus.emit('canvas:dirty');
      } else if (e.deltaMode === 0 && (Math.abs(e.deltaX) > 0 || Math.abs(e.deltaY) > 0)) {
        // Two-finger trackpad scroll: usually has deltaX or small deltaY
        // Mouse wheel: deltaX is 0, deltaY is large discrete steps (100+)
        const isTrackpadPan = Math.abs(e.deltaX) > 0 || Math.abs(e.deltaY) < 40;
        if (isTrackpadPan) {
          doc.panX -= e.deltaX;
          doc.panY -= e.deltaY;
          bus.emit('canvas:dirty');
        } else {
          // Mouse scroll wheel — stepped zoom
          const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
          const newZoom = Math.max(0.05, Math.min(32, doc.zoom * factor));
          doc.panX = mx - (mx - doc.panX) * (newZoom / doc.zoom);
          doc.panY = my - (my - doc.panY) * (newZoom / doc.zoom);
          doc.zoom = newZoom;
          this._syncZoomUI();
          bus.emit('canvas:dirty');
        }
      }
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
          case 'c': e.preventDefault(); this.copySelection(); return;
          case 'x':
            e.preventDefault();
            if (shift) this.cropToSelection();
            else this.cutSelection();
            return;
          case 'v': e.preventDefault(); this._pasteWithFallback(); return;
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
        case 'enter':
          e.preventDefault();
          if (this.toolManager.activeTool?.commit) this.toolManager.activeTool.commit();
          break;
        case 'escape':
          e.preventDefault();
          if (this.toolManager.activeTool?.cancel) this.toolManager.activeTool.cancel();
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
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.startsWith('image/')) {
            e.preventDefault();
            const blob = items[i].getAsFile();
            if (blob) { this._pasteImageBlob(blob); return; }
          }
        }
      }
      // Fallback: clipboardData.files (Firefox, Safari)
      const files = e.clipboardData?.files;
      if (files) {
        for (let i = 0; i < files.length; i++) {
          if (files[i].type.startsWith('image/')) {
            e.preventDefault();
            this._pasteImageBlob(files[i]);
            return;
          }
        }
      }
      // Last resort: try async clipboard API, then internal buffer
      e.preventDefault();
      this._pasteWithFallback();
    });
  }

  async _pasteWithFallback() {
    // Try async clipboard API first
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
    } catch {}
    // Fall back to internal copied canvas
    if (bus._copiedCanvas) {
      this._pasteInternalCanvas(bus._copiedCanvas);
    }
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

  _initZoom() {
    const input = document.getElementById('zoom-input');
    const slider = document.getElementById('zoom-slider');

    input.addEventListener('change', () => {
      const doc = this.doc;
      if (!doc) return;
      let val = parseInt(input.value);
      if (isNaN(val) || val < 5) val = 5;
      if (val > 3200) val = 3200;
      const vp = document.getElementById('viewport').getBoundingClientRect();
      const cx = vp.width / 2, cy = vp.height / 2;
      const newZoom = val / 100;
      doc.panX = cx - (cx - doc.panX) * (newZoom / doc.zoom);
      doc.panY = cy - (cy - doc.panY) * (newZoom / doc.zoom);
      doc.zoom = newZoom;
      this._syncZoomUI();
      bus.emit('canvas:dirty');
    });

    // Logarithmic slider: maps 0-100 range to 5%-3200% zoom
    slider.addEventListener('input', () => {
      const doc = this.doc;
      if (!doc) return;
      const t = slider.value / 100;
      const newZoom = 0.05 * Math.pow(32 / 0.05, t);
      const vp = document.getElementById('viewport').getBoundingClientRect();
      const cx = vp.width / 2, cy = vp.height / 2;
      doc.panX = cx - (cx - doc.panX) * (newZoom / doc.zoom);
      doc.panY = cy - (cy - doc.panY) * (newZoom / doc.zoom);
      doc.zoom = newZoom;
      this._syncZoomUI(true); // skip slider to avoid feedback loop
      bus.emit('canvas:dirty');
    });
  }

  _syncZoomUI(skipSlider) {
    const doc = this.doc;
    if (!doc) return;
    const pct = Math.round(doc.zoom * 100);
    document.getElementById('zoom-input').value = pct;
    if (!skipSlider) {
      // Inverse of logarithmic mapping
      const t = Math.log(doc.zoom / 0.05) / Math.log(32 / 0.05);
      document.getElementById('zoom-slider').value = Math.round(t * 100);
    }
  }

  _initSelectionStatus() {
    this._selectionStatus = document.getElementById('status-selection');
    const update = () => this._updateSelectionStatus();
    bus.on('doc:switched', update);
    bus.on('canvas:dirty', update);
    bus.on('layers:changed', update);
    update();
  }

  _updateSelectionStatus() {
    const el = this._selectionStatus;
    if (!el) return;
    const bounds = this.doc?.selection?.active ? this.doc.selection.bounds : null;
    if (!bounds) {
      el.textContent = '';
      el.classList.add('hidden');
      return;
    }
    el.textContent = `Selection: ${bounds.w} x ${bounds.h}`;
    el.classList.remove('hidden');
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

  /**
   * Core paste logic: places image source at the right position,
   * creates a new layer above current, and selects the pasted region.
   * @param {CanvasImageSource} src - canvas or image element
   * @param {number} pw - paste width
   * @param {number} ph - paste height
   */
  _pasteAtPosition(src, pw, ph) {
    const doc = this.doc;
    if (!doc) return;

    // Determine paste position
    let px, py;
    const sel = doc.selection;
    if (sel.active && sel.bounds) {
      px = sel.bounds.x;
      py = sel.bounds.y;
    } else {
      // Center in viewport
      const vp = document.getElementById('viewport').getBoundingClientRect();
      const center = doc.screenToDoc(vp.width / 2, vp.height / 2);
      px = Math.round(center.x - pw / 2);
      py = Math.round(center.y - ph / 2);
    }

    // Expand canvas if pasted content extends beyond bounds
    const needW = Math.max(doc.width, px + pw);
    const needH = Math.max(doc.height, py + ph);
    if (needW > doc.width || needH > doc.height) {
      doc.saveStructureState('Paste');
      doc.resizeCanvas(needW, needH, 0, 0);
      document.getElementById('status-size').textContent = `${doc.width} x ${doc.height}`;
    } else {
      doc.saveStructureState('Paste');
    }

    // Create new layer above current and draw at position
    const layer = doc.addLayer('Pasted');
    layer.ctx.drawImage(src, px, py);

    // Select the pasted region
    doc.selection.setRect(px, py, pw, ph);

    bus.emit('layers:changed');
    bus.emit('canvas:dirty');
  }

  _pasteInternalCanvas(srcCanvas) {
    if (!this.doc) return;
    this._pasteAtPosition(srcCanvas, srcCanvas.width, srcCanvas.height);
  }

  _pasteImageBlob(blob) {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      bus._lastClipboardSize = { width: img.width, height: img.height };
      if (this.doc) {
        this._pasteAtPosition(img, img.width, img.height);
      } else {
        bus.emit('doc:new', img.width, img.height, 'Pasted', 'transparent');
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
    // Cancel any active transform tool so its floating buffer
    // doesn't get committed on top of the restored state
    const tool = this.toolManager.activeTool;
    if (tool && tool._active) {
      tool._active = false;
      tool._dragging = false;
      if (tool._buffer) tool._buffer = null;
    }
    if (this.doc.undo()) {
      bus.emit('canvas:dirty');
      bus.emit('layers:changed');
      document.getElementById('status-size').textContent = `${this.doc.width} x ${this.doc.height}`;
    }
  }

  redo() {
    if (!this.doc) return;
    const tool = this.toolManager.activeTool;
    if (tool && tool._active) {
      tool._active = false;
      tool._dragging = false;
      if (tool._buffer) tool._buffer = null;
    }
    if (this.doc.redo()) {
      bus.emit('canvas:dirty');
      bus.emit('layers:changed');
      document.getElementById('status-size').textContent = `${this.doc.width} x ${this.doc.height}`;
    }
  }

  selectAll() {
    if (!this.doc) return;
    this.doc.saveSelectionState('Select All');
    this.doc.selection.setRect(0, 0, this.doc.width, this.doc.height);
    bus.emit('canvas:dirty');
  }

  deselect() {
    if (!this.doc) return;
    this.doc.saveSelectionState('Deselect');
    this.doc.selection.clear();
    bus.emit('canvas:dirty');
  }

  /** Copy selected region to clipboard as PNG */
  copySelection() {
    const doc = this.doc;
    if (!doc) return;
    const layer = doc.activeLayer;
    if (!layer) return;

    let sx = 0, sy = 0, sw = doc.width, sh = doc.height;
    const sel = doc.selection;
    if (sel.active && sel.bounds) {
      sx = sel.bounds.x; sy = sel.bounds.y;
      sw = sel.bounds.w; sh = sel.bounds.h;
    }

    // Render selected pixels to a temp canvas
    const tmp = document.createElement('canvas');
    tmp.width = sw; tmp.height = sh;
    const tctx = tmp.getContext('2d');
    tctx.drawImage(layer.canvas, sx, sy, sw, sh, 0, 0, sw, sh);

    // Mask out unselected pixels for non-rectangular selections
    if (sel.active && sel.mask) {
      const id = tctx.getImageData(0, 0, sw, sh);
      const d = id.data;
      for (let row = 0; row < sh; row++) {
        for (let col = 0; col < sw; col++) {
          if (!sel.isSelected(col + sx, row + sy)) {
            const pi = (row * sw + col) * 4;
            d[pi] = 0; d[pi+1] = 0; d[pi+2] = 0; d[pi+3] = 0;
          }
        }
      }
      tctx.putImageData(id, 0, 0);
    }

    // Store internally for in-app paste fallback
    bus._copiedCanvas = tmp;

    // Write to system clipboard — pass a Promise so the write stays
    // in the user gesture context (toBlob callback loses it)
    try {
      const blobPromise = new Promise(resolve => tmp.toBlob(resolve, 'image/png'));
      navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blobPromise })
      ]);
    } catch (err) {
      // Clipboard API may not be available — internal copy still works
    }

    bus._lastClipboardSize = { width: sw, height: sh };
  }

  /** Cut selected region: copy to clipboard then delete */
  cutSelection() {
    this.copySelection();
    this._deleteSelection();
  }

  _deleteSelection() {
    const doc = this.doc;
    if (!doc || !doc.selection.active) return;
    doc.saveDrawState('Delete Selection');
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
    doc.saveStructureState('Flatten');
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

  /** Split the current document's active layer into layers by fixed square frames */
  splitSpriteSheet() {
    const doc = this.doc;
    if (!doc) return;
    const layer = doc.activeLayer;
    if (!layer) return;

    const frameSize = doc.height; // square frames: width = height
    const frameCount = Math.floor(doc.width / frameSize);
    if (frameCount <= 1) return; // nothing to split

    doc.saveStructureState('Split Sprite Sheet');

    // Extract each frame into a new layer
    const srcIdx = doc.activeLayerIndex;
    for (let i = 0; i < frameCount; i++) {
      const newLayer = doc.addLayer(`Frame ${i + 1}`);
      newLayer.ctx.drawImage(
        layer.canvas,
        i * frameSize, 0, frameSize, frameSize,
        0, 0, frameSize, frameSize
      );
    }

    // Resize canvas to single frame size, remove source layer
    doc.layers.splice(srcIdx, 1);
    doc.activeLayerIndex = Math.min(srcIdx, doc.layers.length - 1);

    // Resize all layer canvases and doc to frame size
    for (const l of doc.layers) {
      const tmp = document.createElement('canvas');
      tmp.width = frameSize; tmp.height = frameSize;
      tmp.getContext('2d').drawImage(l.canvas, 0, 0);
      l.canvas.width = frameSize;
      l.canvas.height = frameSize;
      l.ctx.drawImage(tmp, 0, 0);
    }
    doc.width = frameSize;
    doc.height = frameSize;
    doc.composite.width = frameSize;
    doc.composite.height = frameSize;
    doc.selection = new Selection(frameSize, frameSize);

    bus.emit('layers:changed');
    bus.emit('canvas:dirty');
    document.getElementById('status-size').textContent = `${doc.width} x ${doc.height}`;
    const vp = document.getElementById('viewport').getBoundingClientRect();
    doc.fitInView(vp.width, vp.height);
    this._syncZoomUI();
  }

  /** Export all layers as a horizontal sprite sheet PNG */
  async exportSpriteSheet() {
    const doc = this.doc;
    if (!doc || doc.layers.length === 0) return;

    const fw = doc.width;
    const fh = doc.height;
    const sheetW = fw * doc.layers.length;

    const sheet = document.createElement('canvas');
    sheet.width = sheetW;
    sheet.height = fh;
    const ctx = sheet.getContext('2d');

    for (let i = 0; i < doc.layers.length; i++) {
      ctx.drawImage(doc.layers[i].canvas, i * fw, 0);
    }

    // Export as PNG blob and save via server or download
    const blob = await new Promise(r => sheet.toBlob(r, 'image/png'));
    const base64 = await new Promise(r => {
      const reader = new FileReader();
      reader.onload = () => r(reader.result.split(',')[1]);
      reader.readAsDataURL(blob);
    });

    const defaultName = (doc.name || 'spritesheet').replace(/\.[^.]+$/, '') + '_sheet.png';

    try {
      const resp = await fetch('/api/file/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: base64,
          filetypes: 'PNG files (*.png)|*.png',
          defaultExt: '.png',
          defaultName: defaultName,
        }),
      });
      const result = await resp.json();
      if (result.error) return;
    } catch (e) {
      // Fallback: download via link
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = defaultName;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  cropToSelection() {
    const doc = this.doc;
    if (!doc || !doc.selection.active || !doc.selection.bounds) return;
    doc.saveStructureState('Crop to Selection');
    doc.cropToSelection();
    bus.emit('layers:changed');
    bus.emit('canvas:dirty');
    document.getElementById('status-size').textContent = `${doc.width} x ${doc.height}`;
    // Re-fit in viewport
    const vp = document.getElementById('viewport').getBoundingClientRect();
    doc.fitInView(vp.width, vp.height);
    this._syncZoomUI();
  }

  showScaleImageDialog() {
    if (!this.doc) return;
    this.scaleImageDialog.show(this.doc);
  }

  showBrightnessContrast() { if (this.doc) this.bcDialog.show(this.doc, 'Brightness/Contrast'); }
  showHSLAdjust() { if (this.doc) this.hslDialog.show(this.doc, 'Hue/Saturation'); }
  showGaussianBlur() { if (this.doc) this.blurDialog.show(this.doc, 'Gaussian Blur'); }
  showSharpen() { if (this.doc) this.sharpenDialog.show(this.doc, 'Sharpen'); }

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
    this._syncZoomUI();
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
    this._syncZoomUI();
    bus.emit('canvas:dirty');
  }

  fitInView() {
    if (!this.doc) return;
    const vp = document.getElementById('viewport').getBoundingClientRect();
    this.doc.fitInView(vp.width, vp.height);
    this._syncZoomUI();
    bus.emit('canvas:dirty');
  }

  actualSize() {
    if (!this.doc) return;
    const vp = document.getElementById('viewport').getBoundingClientRect();
    this.doc.zoom = 1;
    this.doc.panX = (vp.width - this.doc.width) / 2;
    this.doc.panY = (vp.height - this.doc.height) / 2;
    this._syncZoomUI();
    bus.emit('canvas:dirty');
  }

  // ===== Flip / Mirror =====

  flipHorizontal() {
    const doc = this.doc;
    if (!doc) return;
    const layer = doc.activeLayer;
    if (!layer || !layer.visible) return;
    doc.saveDrawState('Flip Horizontal');
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
    doc.saveDrawState('Flip Vertical');
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

  // ===== Rotation =====

  rotateCW() { this._rotate(90); }
  rotateCCW() { this._rotate(-90); }
  rotate180() { this._rotate(180); }

  _rotate(degrees) {
    const doc = this.doc;
    if (!doc) return;
    const sel = doc.selection;
    if (sel.active && sel.bounds) {
      // Rotate within selection bounds
      const layer = doc.activeLayer;
      if (!layer || !layer.visible) return;
      doc.saveDrawState('Rotate ' + degrees + '°');
      const { x, y, w, h } = sel.bounds;
      const temp = document.createElement('canvas');
      temp.width = w; temp.height = h;
      const tctx = temp.getContext('2d');
      tctx.drawImage(layer.canvas, x, y, w, h, 0, 0, w, h);
      const isSquare = w === h;
      const rw = (degrees === 180 || isSquare) ? w : h;
      const rh = (degrees === 180 || isSquare) ? h : w;
      const rot = document.createElement('canvas');
      rot.width = rw; rot.height = rh;
      const rctx = rot.getContext('2d');
      rctx.translate(rw / 2, rh / 2);
      rctx.rotate(degrees * Math.PI / 180);
      rctx.drawImage(temp, -w / 2, -h / 2);
      layer.ctx.clearRect(x, y, w, h);
      layer.ctx.drawImage(rot, x, y);
      bus.emit('canvas:dirty');
    } else {
      // Rotate entire image (all layers) — may change document dimensions
      const swapDims = (degrees === 90 || degrees === -90);
      const newW = swapDims ? doc.height : doc.width;
      const newH = swapDims ? doc.width : doc.height;
      doc.saveStructureState('Rotate ' + degrees + '°');
      for (const layer of doc.layers) {
        const temp = document.createElement('canvas');
        temp.width = layer.canvas.width; temp.height = layer.canvas.height;
        temp.getContext('2d').drawImage(layer.canvas, 0, 0);
        layer.canvas.width = newW;
        layer.canvas.height = newH;
        layer.ctx.translate(newW / 2, newH / 2);
        layer.ctx.rotate(degrees * Math.PI / 180);
        layer.ctx.drawImage(temp, -temp.width / 2, -temp.height / 2);
        layer.ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
      doc.width = newW;
      doc.height = newH;
      doc.composite.width = newW;
      doc.composite.height = newH;
      doc.selection = new Selection(newW, newH);
      bus.emit('layers:changed');
      bus.emit('canvas:dirty');
      document.getElementById('status-size').textContent = `${newW} x ${newH}`;
      const vp = document.getElementById('viewport').getBoundingClientRect();
      doc.fitInView(vp.width, vp.height);
      this._syncZoomUI();
    }
  }

  // ===== Quick Adjustments (no dialog) =====

  invertColors() {
    const doc = this.doc;
    if (!doc) return;
    const layer = doc.activeLayer;
    if (!layer || !layer.visible) return;
    doc.saveDrawState('Invert Colors');
    const imageData = layer.ctx.getImageData(0, 0, doc.width, doc.height);
    const d = imageData.data;
    const mask = doc.selection.active ? doc.selection.mask : null;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      if (mask && !mask[i / 4]) continue;
      d[i] = 255 - d[i];
      d[i + 1] = 255 - d[i + 1];
      d[i + 2] = 255 - d[i + 2];
    }
    layer.ctx.putImageData(imageData, 0, 0);
    bus.emit('canvas:dirty');
  }

  desaturate() {
    const doc = this.doc;
    if (!doc) return;
    const layer = doc.activeLayer;
    if (!layer || !layer.visible) return;
    doc.saveDrawState('Desaturate');
    const imageData = layer.ctx.getImageData(0, 0, doc.width, doc.height);
    const d = imageData.data;
    const mask = doc.selection.active ? doc.selection.mask : null;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      if (mask && !mask[i / 4]) continue;
      const gray = Math.round(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
      d[i] = gray; d[i + 1] = gray; d[i + 2] = gray;
    }
    layer.ctx.putImageData(imageData, 0, 0);
    bus.emit('canvas:dirty');
  }

  posterize(levels = 4) {
    const doc = this.doc;
    if (!doc) return;
    const layer = doc.activeLayer;
    if (!layer || !layer.visible) return;
    doc.saveDrawState('Posterize');
    const imageData = layer.ctx.getImageData(0, 0, doc.width, doc.height);
    const d = imageData.data;
    const mask = doc.selection.active ? doc.selection.mask : null;
    const step = 255 / (levels - 1);
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      if (mask && !mask[i / 4]) continue;
      d[i] = Math.round(Math.round(d[i] / step) * step);
      d[i + 1] = Math.round(Math.round(d[i + 1] / step) * step);
      d[i + 2] = Math.round(Math.round(d[i + 2] / step) * step);
    }
    layer.ctx.putImageData(imageData, 0, 0);
    bus.emit('canvas:dirty');
  }

  threshold(level = 128) {
    const doc = this.doc;
    if (!doc) return;
    const layer = doc.activeLayer;
    if (!layer || !layer.visible) return;
    doc.saveDrawState('Threshold');
    const imageData = layer.ctx.getImageData(0, 0, doc.width, doc.height);
    const d = imageData.data;
    const mask = doc.selection.active ? doc.selection.mask : null;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      if (mask && !mask[i / 4]) continue;
      const gray = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      const val = gray >= level ? 255 : 0;
      d[i] = val; d[i + 1] = val; d[i + 2] = val;
    }
    layer.ctx.putImageData(imageData, 0, 0);
    bus.emit('canvas:dirty');
  }

  // ===== Selection operations =====

  invertSelection() {
    const doc = this.doc;
    if (!doc) return;
    const sel = doc.selection;
    if (!sel.active) return;
    doc.saveSelectionState('Invert Selection');
    const mask = new Uint8Array(doc.width * doc.height);
    for (let i = 0; i < mask.length; i++) {
      mask[i] = sel.mask ? (sel.mask[i] ? 0 : 1) : 0;
    }
    // Compute bounds of inverted selection
    let minX = doc.width, minY = doc.height, maxX = 0, maxY = 0;
    for (let y = 0; y < doc.height; y++) {
      for (let x = 0; x < doc.width; x++) {
        if (mask[y * doc.width + x]) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX) { sel.clear(); }
    else { sel.setMask(mask, { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }); }
    bus.emit('canvas:dirty');
  }

  strokeSelection() {
    const doc = this.doc;
    if (!doc || !doc.selection.active || !doc.selection.bounds) return;
    const layer = doc.activeLayer;
    if (!layer || !layer.visible) return;
    doc.saveDrawState('Stroke Selection');
    const sel = doc.selection;
    const { x, y, w, h } = sel.bounds;
    const size = bus._brushSize || 1;
    const [r, g, b] = bus._primaryColor || [0, 0, 0];
    const a = (bus._brushAlpha !== undefined ? bus._brushAlpha : 255) / 255;
    layer.ctx.save();
    layer.ctx.strokeStyle = `rgba(${r},${g},${b},${a})`;
    layer.ctx.lineWidth = size;
    if (sel._contours) {
      // Non-rectangular: stroke the contour paths
      layer.ctx.beginPath();
      for (const path of sel._contours) {
        layer.ctx.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i++) {
          layer.ctx.lineTo(path[i].x, path[i].y);
        }
      }
      layer.ctx.stroke();
    } else {
      // Rectangular: stroke the rect
      layer.ctx.strokeRect(x + size / 2, y + size / 2, w - size, h - size);
    }
    layer.ctx.restore();
    bus.emit('canvas:dirty');
  }

  // ===== Posterize/Threshold Dialogs =====

  showPosterize() { if (this.doc) this.posterizeDialog.show(this.doc, 'Posterize'); }
  showThreshold() { if (this.doc) this.thresholdDialog.show(this.doc, 'Threshold'); }

  // ===== File I/O =====

  /** Check if the Python server API is available (cached after first check) */
  async _hasServer() {
    if (this._serverAvailable !== undefined) return this._serverAvailable;
    try {
      const resp = await fetch('/api/ping', { method: 'POST' });
      this._serverAvailable = resp.ok;
    } catch {
      this._serverAvailable = false;
    }
    return this._serverAvailable;
  }

  /** Prompt user to pick a file via browser <input type="file"> */
  _browserPickFile(accept) {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      if (accept) input.accept = accept;
      input.addEventListener('change', () => {
        resolve(input.files[0] || null);
      });
      // Handle cancel (input won't fire change)
      input.addEventListener('cancel', () => resolve(null));
      input.click();
    });
  }

  /** Trigger a browser download of a Blob */
  _browserDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async openFile() {
    const hasServer = await this._hasServer();
    if (hasServer) {
      try {
        const resp = await fetch('/api/file/open', { method: 'POST' });
        const data = await resp.json();
        if (data.cancelled) return;
        if (data.error) { alert('Error: ' + data.error); return; }
        if (data.name?.endsWith('.gbp')) {
          this.openProject();
          return;
        }
        bus.emit('doc:open-image', data.data, data.name);
      } catch (e) {
        alert('Error opening file: ' + e.message);
      }
    } else {
      // Browser fallback
      const file = await this._browserPickFile('image/png,image/jpeg,image/bmp,image/gif,.gbp');
      if (!file) return;
      if (file.name.endsWith('.gbp')) {
        await this._browserOpenProject(file);
        return;
      }
      const dataUrl = await new Promise(r => {
        const reader = new FileReader();
        reader.onload = () => r(reader.result);
        reader.readAsDataURL(file);
      });
      bus.emit('doc:open-image', dataUrl, file.name);
    }
  }

  async saveFile() {
    const doc = this.doc;
    if (!doc) return;
    doc.compositeAll();

    const hasServer = await this._hasServer();
    if (hasServer) {
      const dataUrl = doc.composite.toDataURL('image/png');
      try {
        const resp = await fetch('/api/file/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: dataUrl, path: doc.path, ext: '.png', defaultName: doc.name.replace(/\.(gbp)$/i, '') }),
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
    } else {
      // Browser fallback — use File System Access API if available for real filename
      const blob = await new Promise(r => doc.composite.toBlob(r, 'image/png'));
      const suggestedName = (doc.name || 'Untitled').replace(/\.(gbp)$/i, '').replace(/\.[^.]+$/, '') + '.png';
      if (window.showSaveFilePicker) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName,
            types: [{ description: 'PNG Image', accept: { 'image/png': ['.png'] } }],
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          doc.name = handle.name;
          doc.dirty = false;
          this.docManager.renderTabs();
          return;
        } catch (e) {
          if (e.name === 'AbortError') return; // user cancelled
        }
      }
      this._browserDownload(blob, suggestedName);
      doc.name = suggestedName;
      doc.dirty = false;
      this.docManager.renderTabs();
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

    const hasServer = await this._hasServer();
    if (hasServer) {
      try {
        const resp = await fetch('/api/project/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            manifest,
            layers,
            path: doc.projectPath,
            defaultName: doc.name.replace(/\.(png|jpg|jpeg|bmp|gbp)$/i, '') + '.gbp',
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
    } else {
      // Browser fallback: build ZIP with JSZip
      const zip = new JSZip();
      zip.file('manifest.json', JSON.stringify(manifest, null, 2));
      const layersFolder = zip.folder('layers');
      for (const l of layers) {
        const b64 = l.data.split(',')[1];
        layersFolder.file(l.file, b64, { base64: true });
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const suggestedName = (doc.name || 'Untitled').replace(/\.(png|jpg|jpeg|bmp|gbp)$/i, '') + '.gbp';
      if (window.showSaveFilePicker) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName,
            types: [{ description: 'GrobPaint Project', accept: { 'application/zip': ['.gbp'] } }],
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          doc.name = handle.name;
          doc.dirty = false;
          this.docManager.renderTabs();
          return;
        } catch (e) {
          if (e.name === 'AbortError') return;
        }
      }
      this._browserDownload(blob, suggestedName);
      doc.name = suggestedName;
      doc.dirty = false;
      this.docManager.renderTabs();
    }
  }

  async openProject() {
    const hasServer = await this._hasServer();
    if (hasServer) {
      try {
        const resp = await fetch('/api/project/open', { method: 'POST' });
        const data = await resp.json();
        if (data.cancelled) return;
        if (data.error) { alert('Error: ' + data.error); return; }
        bus.emit('doc:open-project', data);
      } catch (e) {
        alert('Error opening project: ' + e.message);
      }
    } else {
      // Browser fallback
      const file = await this._browserPickFile('.gbp');
      if (!file) return;
      await this._browserOpenProject(file);
    }
  }

  /** Open a .gbp project file from a browser File object */
  async _browserOpenProject(file) {
    try {
      const zip = await JSZip.loadAsync(file);
      const manifestJson = await zip.file('manifest.json').async('string');
      const manifest = JSON.parse(manifestJson);
      const layers = [];
      for (const layerInfo of manifest.layers) {
        const pngData = await zip.file(`layers/${layerInfo.file}`).async('base64');
        layers.push({
          ...layerInfo,
          data: `data:image/png;base64,${pngData}`,
        });
      }
      bus.emit('doc:open-project', { manifest, layers, name: file.name, path: null });
    } catch (e) {
      alert('Error opening project: ' + e.message);
    }
  }
}

// ===== Start =====
window.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
