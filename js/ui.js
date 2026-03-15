// ===== GrobPaint UI — colors, layers, tabs, dialogs, menus, status =====

import { bus, PaintDocument, Layer } from './core.js';

// ===== Color helpers =====

function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  s /= 100; v /= 100;
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0, s = max === 0 ? 0 : d / max, v = max;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return [Math.round(h), Math.round(s * 100), Math.round(v * 100)];
}

function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  return [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)];
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

// ===== Palette Data =====

const PALETTES = {
  lospec500: [
    '#10121c','#2c1e31','#6b2643','#ac2847','#ec273f','#94493a','#de5d3a','#e98537',
    '#f3a833','#4d3533','#6e4c30','#a26d3f','#ce9248','#dab163','#e8d282','#f7f3b7',
    '#1e4044','#006554','#26854c','#5ab552','#9de64e','#008b8b','#62a477','#a6cb96',
    '#d3eed3','#3e3b65','#3859b3','#3388de','#36c5f4','#6dead6','#5e5b8c','#8c78a5',
    '#b0a7b8','#deceed','#9a4d76','#c878af','#cc99ff','#fa6e79','#ffa2ac','#ffd1d5',
    '#f6e8e0','#ffffff',
  ],
  pico8: [
    '#000000','#1d2b53','#7e2553','#008751','#ab5236','#5f574f','#c2c3c7','#fff1e8',
    '#ff004d','#ffa300','#ffec27','#00e436','#29adff','#83769c','#ff77a8','#ffccaa',
  ],
};

// ===== Color System =====

export class ColorSystem {
  constructor() {
    this.primaryRgb = [0, 0, 0];
    this.secondaryRgb = [255, 255, 255];
    this.hsv = [0, 0, 0]; // current HSV for picker
    this._editingTarget = 'primary'; // which swatch the HSV picker edits

    bus._primaryColor = '#000000';
    bus._secondaryColor = '#ffffff';
    bus._brushAlpha = 1;

    this._initPalette();
    this._initSwatches();
    this._initAlpha();
    this._initHSVPicker();

    bus.on('color:set-primary', hex => this.setPrimary(hex));
    bus.on('color:set-secondary', hex => this.setSecondary(hex));
  }

  setPrimary(hex) {
    this.primaryRgb = hexToRgb(hex);
    bus._primaryColor = hex;
    this._editingTarget = 'primary';
    this.hsv = rgbToHsv(...this.primaryRgb);
    this._updateUI();
  }

  setSecondary(hex) {
    this.secondaryRgb = hexToRgb(hex);
    bus._secondaryColor = hex;
    this._editingTarget = 'secondary';
    this.hsv = rgbToHsv(...this.secondaryRgb);
    this._updateUI();
  }

  swap() {
    const tmp = this.primaryRgb;
    this.primaryRgb = this.secondaryRgb;
    this.secondaryRgb = tmp;
    bus._primaryColor = rgbToHex(...this.primaryRgb);
    bus._secondaryColor = rgbToHex(...this.secondaryRgb);
    this.hsv = rgbToHsv(...this.primaryRgb);
    this._editingTarget = 'primary';
    this._updateUI();
  }

  _updateUI() {
    document.getElementById('swatch-primary').style.background = rgbToHex(...this.primaryRgb);
    document.getElementById('swatch-secondary').style.background = rgbToHex(...this.secondaryRgb);

    const [h, s, v] = this.hsv;
    const [r, g, b] = this._editingTarget === 'primary' ? this.primaryRgb : this.secondaryRgb;

    // HSV picker
    this._updateSVSquare(h);
    document.getElementById('sv-cursor').style.left = (s) + '%';
    document.getElementById('sv-cursor').style.top = (100 - v) + '%';
    document.getElementById('hue-cursor').style.left = (h / 360 * 100) + '%';

    // Inputs
    document.getElementById('input-h').value = h;
    document.getElementById('input-s').value = s;
    document.getElementById('input-v').value = v;
    document.getElementById('input-r').value = r;
    document.getElementById('input-g').value = g;
    document.getElementById('input-b').value = b;
    document.getElementById('input-hex').value = rgbToHex(r, g, b);
  }

  _updateSVSquare(hue) {
    const [r, g, b] = hsvToRgb(hue, 100, 100);
    document.getElementById('sv-square').style.background =
      `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, rgb(${r},${g},${b}))`;
  }

  _applyHSV() {
    const rgb = hsvToRgb(...this.hsv);
    if (this._editingTarget === 'primary') {
      this.primaryRgb = rgb;
      bus._primaryColor = rgbToHex(...rgb);
    } else {
      this.secondaryRgb = rgb;
      bus._secondaryColor = rgbToHex(...rgb);
    }
    this._updateUI();
  }

  _initPalette() {
    this._loadPalette('lospec500');

    const select = document.getElementById('palette-select');
    select.addEventListener('change', () => {
      this._loadPalette(select.value);
    });
  }

  _loadPalette(name) {
    const palette = document.getElementById('palette');
    palette.innerHTML = '';
    const colors = PALETTES[name] || PALETTES.lospec500;

    // Adjust grid columns: 8 for large palettes, 4 for small ones like pico-8
    palette.style.gridTemplateColumns = `repeat(${colors.length <= 16 ? 4 : 8}, 1fr)`;

    for (const c of colors) {
      const el = document.createElement('div');
      el.className = 'palette-color';
      el.style.background = c;
      el.addEventListener('mousedown', e => {
        e.preventDefault();
        if (e.button === 2) this.setSecondary(c);
        else this.setPrimary(c);
      });
      el.addEventListener('contextmenu', e => e.preventDefault());
      palette.appendChild(el);
    }
  }

  _initSwatches() {
    document.getElementById('swatch-primary').addEventListener('click', () => {
      this._editingTarget = 'primary';
      this.hsv = rgbToHsv(...this.primaryRgb);
      this._updateUI();
    });
    document.getElementById('swatch-secondary').addEventListener('click', () => {
      this._editingTarget = 'secondary';
      this.hsv = rgbToHsv(...this.secondaryRgb);
      this._updateUI();
    });
    document.getElementById('swap-colors').addEventListener('click', () => this.swap());
    this._updateUI();
  }

  _initAlpha() {
    const slider = document.getElementById('alpha-slider');
    const label = document.getElementById('alpha-value');
    slider.addEventListener('input', () => {
      const a = parseInt(slider.value);
      bus._brushAlpha = a / 255;
      label.textContent = a;
    });
  }

  _initHSVPicker() {
    const toggle = document.getElementById('toggle-hsv');
    const picker = document.getElementById('hsv-picker');
    toggle.addEventListener('click', () => {
      const hidden = picker.classList.toggle('hidden');
      toggle.innerHTML = hidden ? 'HSV Picker &#x25BC;' : 'HSV Picker &#x25B2;';
    });

    // SV square
    const svSquare = document.getElementById('sv-square');
    let draggingSV = false;
    const updateSV = (e) => {
      const r = svSquare.getBoundingClientRect();
      const s = Math.max(0, Math.min(100, (e.clientX - r.left) / r.width * 100));
      const v = Math.max(0, Math.min(100, 100 - (e.clientY - r.top) / r.height * 100));
      this.hsv[1] = Math.round(s);
      this.hsv[2] = Math.round(v);
      this._applyHSV();
    };
    svSquare.addEventListener('pointerdown', e => { draggingSV = true; svSquare.setPointerCapture(e.pointerId); updateSV(e); });
    svSquare.addEventListener('pointermove', e => { if (draggingSV) updateSV(e); });
    svSquare.addEventListener('pointerup', () => { draggingSV = false; });

    // Hue bar
    const hueBar = document.getElementById('hue-bar');
    let draggingHue = false;
    const updateHue = (e) => {
      const r = hueBar.getBoundingClientRect();
      this.hsv[0] = Math.round(Math.max(0, Math.min(360, (e.clientX - r.left) / r.width * 360)));
      this._applyHSV();
    };
    hueBar.addEventListener('pointerdown', e => { draggingHue = true; hueBar.setPointerCapture(e.pointerId); updateHue(e); });
    hueBar.addEventListener('pointermove', e => { if (draggingHue) updateHue(e); });
    hueBar.addEventListener('pointerup', () => { draggingHue = false; });

    // Number inputs
    for (const id of ['input-h', 'input-s', 'input-v']) {
      document.getElementById(id).addEventListener('change', () => {
        this.hsv = [
          parseInt(document.getElementById('input-h').value) || 0,
          parseInt(document.getElementById('input-s').value) || 0,
          parseInt(document.getElementById('input-v').value) || 0,
        ];
        this._applyHSV();
      });
    }
    for (const id of ['input-r', 'input-g', 'input-b']) {
      document.getElementById(id).addEventListener('change', () => {
        const r = parseInt(document.getElementById('input-r').value) || 0;
        const g = parseInt(document.getElementById('input-g').value) || 0;
        const b = parseInt(document.getElementById('input-b').value) || 0;
        this.hsv = rgbToHsv(r, g, b);
        this._applyHSV();
      });
    }
    document.getElementById('input-hex').addEventListener('change', () => {
      const hex = document.getElementById('input-hex').value;
      if (/^#?[0-9a-fA-F]{6}$/.test(hex.replace('#', ''))) {
        const [r, g, b] = hexToRgb(hex);
        this.hsv = rgbToHsv(r, g, b);
        this._applyHSV();
      }
    });
  }
}

// ===== Layers Panel =====

export class LayersPanel {
  constructor() {
    this.doc = null;
    this._initButtons();

    bus.on('doc:switched', doc => { this.doc = doc; this.render(); });
    bus.on('layers:changed', () => this.render());
    bus.on('canvas:dirty', () => this._updateThumbnails());

    // Blend mode
    document.getElementById('blend-mode').addEventListener('change', e => {
      if (!this.doc) return;
      this.doc.activeLayer.blendMode = e.target.value;
      bus.emit('canvas:dirty');
    });

    // Opacity
    const opSlider = document.getElementById('layer-opacity');
    const opLabel = document.getElementById('layer-opacity-value');
    opSlider.addEventListener('input', () => {
      if (!this.doc) return;
      const v = parseInt(opSlider.value);
      this.doc.activeLayer.opacity = v / 100;
      opLabel.textContent = v + '%';
      bus.emit('canvas:dirty');
    });
  }

  _initButtons() {
    document.getElementById('btn-layer-add').addEventListener('click', () => {
      if (!this.doc) return;
      this.doc.saveStructureState();
      this.doc.addLayer();
      bus.emit('layers:changed');
      bus.emit('canvas:dirty');
    });
    document.getElementById('btn-layer-delete').addEventListener('click', () => {
      if (!this.doc || this.doc.layers.length <= 1) return;
      this.doc.saveStructureState();
      this.doc.removeLayer();
      bus.emit('layers:changed');
      bus.emit('canvas:dirty');
    });
    document.getElementById('btn-layer-up').addEventListener('click', () => {
      if (!this.doc) return;
      const i = this.doc.activeLayerIndex;
      if (i >= this.doc.layers.length - 1) return;
      this.doc.saveStructureState();
      this.doc.moveLayer(i, i + 1);
      bus.emit('layers:changed');
      bus.emit('canvas:dirty');
    });
    document.getElementById('btn-layer-down').addEventListener('click', () => {
      if (!this.doc) return;
      const i = this.doc.activeLayerIndex;
      if (i <= 0) return;
      this.doc.saveStructureState();
      this.doc.moveLayer(i, i - 1);
      bus.emit('layers:changed');
      bus.emit('canvas:dirty');
    });
    document.getElementById('btn-layer-duplicate').addEventListener('click', () => {
      if (!this.doc) return;
      this.doc.saveStructureState();
      this.doc.duplicateLayer();
      bus.emit('layers:changed');
      bus.emit('canvas:dirty');
    });
    document.getElementById('btn-layer-merge').addEventListener('click', () => {
      if (!this.doc) return;
      if (this.doc.activeLayerIndex <= 0) return;
      this.doc.saveStructureState();
      this.doc.mergeDown();
      bus.emit('layers:changed');
      bus.emit('canvas:dirty');
    });
  }

  render() {
    const doc = this.doc;
    if (!doc) return;

    const list = document.getElementById('layer-list');
    list.innerHTML = '';

    // Render top-to-bottom (highest index = top layer shown first)
    for (let i = doc.layers.length - 1; i >= 0; i--) {
      const layer = doc.layers[i];
      const item = document.createElement('div');
      item.className = 'layer-item' + (i === doc.activeLayerIndex ? ' active' : '');
      item.dataset.index = i;

      // Visibility toggle
      const vis = document.createElement('span');
      vis.className = 'layer-visibility';
      vis.textContent = layer.visible ? '👁' : '○';
      vis.addEventListener('click', e => {
        e.stopPropagation();
        layer.visible = !layer.visible;
        this.render();
        bus.emit('canvas:dirty');
      });

      // Thumbnail
      const thumbWrap = document.createElement('div');
      thumbWrap.className = 'layer-thumb';
      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = 32;
      thumbCanvas.height = 24;
      const tctx = thumbCanvas.getContext('2d');
      tctx.drawImage(layer.canvas, 0, 0, 32, 24);
      thumbWrap.appendChild(thumbCanvas);

      // Name
      const name = document.createElement('span');
      name.className = 'layer-name';
      name.textContent = layer.name;
      name.addEventListener('dblclick', e => {
        e.stopPropagation();
        name.contentEditable = 'true';
        name.focus();
        const onDone = () => {
          name.contentEditable = 'false';
          layer.name = name.textContent.trim() || layer.name;
          name.removeEventListener('blur', onDone);
        };
        name.addEventListener('blur', onDone);
        name.addEventListener('keydown', ke => {
          if (ke.key === 'Enter') { ke.preventDefault(); name.blur(); }
        });
      });

      item.appendChild(vis);
      item.appendChild(thumbWrap);
      item.appendChild(name);

      item.addEventListener('click', () => {
        doc.activeLayerIndex = i;
        this.render();
        this._syncControls();
      });

      list.appendChild(item);
    }

    this._syncControls();
  }

  _syncControls() {
    if (!this.doc) return;
    const layer = this.doc.activeLayer;
    if (!layer) return;
    document.getElementById('blend-mode').value = layer.blendMode;
    document.getElementById('layer-opacity').value = Math.round(layer.opacity * 100);
    document.getElementById('layer-opacity-value').textContent = Math.round(layer.opacity * 100) + '%';
  }

  _updateThumbnails() {
    if (!this.doc) return;
    const items = document.querySelectorAll('.layer-item');
    items.forEach(item => {
      const i = parseInt(item.dataset.index);
      const layer = this.doc.layers[i];
      if (!layer) return;
      const canvas = item.querySelector('canvas');
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 32, 24);
        ctx.drawImage(layer.canvas, 0, 0, 32, 24);
      }
    });
  }
}

// ===== Document Manager (tabs) =====

export class DocManager {
  constructor() {
    this.docs = [];
    this.activeIndex = -1;

    bus.on('doc:new', (w, h, name, bg) => this.createDoc(w, h, name, bg));
    bus.on('doc:close', index => this.closeDoc(index));
    bus.on('doc:switch', index => this.switchTo(index));
    bus.on('doc:open-image', (dataUrl, name) => this.openImage(dataUrl, name));
    bus.on('doc:open-project', (data) => this.openProject(data));
  }

  get activeDoc() {
    return this.docs[this.activeIndex] || null;
  }

  createDoc(w = 1280, h = 720, name = 'Untitled', bg = 'white') {
    const doc = new PaintDocument(w, h, name, bg);
    this.docs.push(doc);
    this.switchTo(this.docs.length - 1);
    return doc;
  }

  switchTo(index) {
    if (index < 0 || index >= this.docs.length) return;
    this.activeIndex = index;
    const doc = this.docs[index];

    // Fit in view on first switch
    const vp = document.getElementById('viewport');
    const r = vp.getBoundingClientRect();
    if (doc.panX === 0 && doc.panY === 0 && doc.zoom === 1) {
      doc.fitInView(r.width, r.height);
    }

    bus.emit('doc:switched', doc);
    this.renderTabs();

    // Update status bar
    document.getElementById('status-size').textContent = `${doc.width} x ${doc.height}`;
    document.getElementById('zoom-input').value = Math.round(doc.zoom * 100);
    document.getElementById('zoom-slider').value = Math.round(Math.log(doc.zoom / 0.05) / Math.log(32 / 0.05) * 100);
  }

  closeDoc(index) {
    if (index === undefined) index = this.activeIndex;
    if (this.docs.length <= 0) return;
    const doc = this.docs[index];
    if (doc.dirty) {
      if (!confirm(`"${doc.name}" has unsaved changes. Close anyway?`)) return;
    }
    this.docs.splice(index, 1);
    if (this.docs.length === 0) {
      this.activeIndex = -1;
      this.createDoc();
    } else {
      this.activeIndex = Math.min(index, this.docs.length - 1);
      this.switchTo(this.activeIndex);
    }
    this.renderTabs();
  }

  openImage(dataUrl, name) {
    const img = new Image();
    img.onload = () => {
      const doc = new PaintDocument(img.width, img.height, name || 'Opened Image', 'transparent');
      doc.activeLayer.ctx.drawImage(img, 0, 0);
      doc.activeLayer.name = 'Image';
      this.docs.push(doc);
      this.switchTo(this.docs.length - 1);
    };
    img.src = dataUrl;
  }

  openProject(data) {
    const m = data.manifest;
    const doc = new PaintDocument(m.width, m.height, data.name || 'Project', 'transparent');
    doc.projectPath = data.path;
    doc.layers = [];
    for (const layerData of data.layers) {
      const layer = new Layer(m.width, m.height, layerData.name);
      layer.opacity = layerData.opacity !== undefined ? layerData.opacity : 1;
      layer.visible = layerData.visible !== undefined ? layerData.visible : true;
      layer.blendMode = layerData.blendMode || 'source-over';
      // Load image data
      const img = new Image();
      img.onload = () => {
        layer.ctx.drawImage(img, 0, 0);
        bus.emit('canvas:dirty');
        bus.emit('layers:changed');
      };
      img.src = layerData.data;
      doc.layers.push(layer);
    }
    doc.activeLayerIndex = 0;
    this.docs.push(doc);
    this.switchTo(this.docs.length - 1);
  }

  renderTabs() {
    const tabBar = document.getElementById('doc-tabs');
    tabBar.innerHTML = '';
    this.docs.forEach((doc, i) => {
      const tab = document.createElement('div');
      tab.className = 'doc-tab' + (i === this.activeIndex ? ' active' : '');

      // Thumbnail
      doc.compositeAll();
      const thumb = document.createElement('canvas');
      thumb.width = 32; thumb.height = 24;
      const tctx = thumb.getContext('2d');
      tctx.drawImage(doc.composite, 0, 0, 32, 24);
      tab.appendChild(thumb);

      // Name
      const nameEl = document.createElement('span');
      nameEl.className = 'tab-name';
      nameEl.textContent = doc.name;
      tab.appendChild(nameEl);

      // Dirty indicator
      if (doc.dirty) {
        const dot = document.createElement('span');
        dot.className = 'tab-dirty';
        dot.textContent = '●';
        tab.appendChild(dot);
      }

      // Close button
      const close = document.createElement('span');
      close.className = 'tab-close';
      close.textContent = '×';
      close.addEventListener('click', e => {
        e.stopPropagation();
        this.closeDoc(i);
      });
      tab.appendChild(close);

      tab.addEventListener('click', () => this.switchTo(i));
      tabBar.appendChild(tab);
    });
  }
}

// ===== Tool Options Bar =====

export class ToolOptionsBar {
  constructor() {
    // Init defaults on bus
    bus._brushSize = 3;
    bus._tolerance = 32;
    bus._antiAlias = true;
    bus._filled = false;
    bus._fontSize = 24;
    bus._fontFamily = 'Arial';
    bus._interpolation = 'nearest';
    bus._wandGlobal = false;

    bus.on('tool:changed', name => this.render(name));
    this.render('pencil');
  }

  render(toolName) {
    const bar = document.getElementById('tool-options');
    bar.innerHTML = '';

    // Brush size (for brush, eraser, pencil, line, rect, ellipse)
    if (['brush', 'eraser', 'line', 'rectangle', 'ellipse'].includes(toolName)) {
      bar.appendChild(this._group('Size:',
        this._numberInput(bus._brushSize, 1, 200, v => bus._brushSize = v)));
      bar.appendChild(this._group('',
        this._rangeInput(bus._brushSize, 1, 200, v => {
          bus._brushSize = v;
          this.render(toolName);
        })));
    }

    // Anti-alias (brush, eraser, line, rectangle, ellipse)
    if (['brush', 'eraser', 'line', 'rectangle', 'ellipse'].includes(toolName)) {
      bar.appendChild(this._group('Anti-alias:',
        this._checkbox(bus._antiAlias, v => bus._antiAlias = v)));
    }

    // Filled (rect, ellipse)
    if (['rectangle', 'ellipse'].includes(toolName)) {
      bar.appendChild(this._group('Filled:',
        this._checkbox(bus._filled, v => bus._filled = v)));
    }

    // Tolerance (fill, wand)
    if (['fill', 'wand'].includes(toolName)) {
      bar.appendChild(this._group('Tolerance:',
        this._numberInput(bus._tolerance, 0, 255, v => bus._tolerance = v)));
      bar.appendChild(this._group('',
        this._rangeInput(bus._tolerance, 0, 255, v => {
          bus._tolerance = v;
          this.render(toolName);
        })));
    }

    // Wand mode (contiguous / global)
    if (toolName === 'wand') {
      const modeSelect = document.createElement('select');
      for (const [val, label] of [['local', 'Contiguous'], ['global', 'Global']]) {
        const opt = document.createElement('option');
        opt.value = val; opt.textContent = label;
        if ((val === 'global') === bus._wandGlobal) opt.selected = true;
        modeSelect.appendChild(opt);
      }
      modeSelect.addEventListener('change', () => bus._wandGlobal = modeSelect.value === 'global');
      bar.appendChild(this._group('Mode:', modeSelect));
    }

    // Interpolation (move tools)
    if (toolName === 'move' || toolName === 'moveselection') {
      const interpSelect = document.createElement('select');
      for (const [val, label] of [['nearest', 'Nearest Neighbor'], ['bilinear', 'Bilinear'], ['bicubic', 'Bicubic']]) {
        const opt = document.createElement('option');
        opt.value = val; opt.textContent = label;
        if (val === bus._interpolation) opt.selected = true;
        interpSelect.appendChild(opt);
      }
      interpSelect.addEventListener('change', () => bus._interpolation = interpSelect.value);
      bar.appendChild(this._group('Resample:', interpSelect));
    }

    // Font (text)
    if (toolName === 'text') {
      const fontSelect = document.createElement('select');
      for (const f of ['Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana', 'monospace']) {
        const opt = document.createElement('option');
        opt.value = f; opt.textContent = f;
        if (f === bus._fontFamily) opt.selected = true;
        fontSelect.appendChild(opt);
      }
      fontSelect.addEventListener('change', () => bus._fontFamily = fontSelect.value);
      bar.appendChild(this._group('Font:', fontSelect));

      bar.appendChild(this._group('Size:',
        this._numberInput(bus._fontSize, 6, 200, v => bus._fontSize = v)));
    }
  }

  _group(label, input) {
    const g = document.createElement('div');
    g.className = 'tool-option-group';
    if (label) {
      const l = document.createElement('label');
      l.textContent = label;
      g.appendChild(l);
    }
    g.appendChild(input);
    return g;
  }

  _numberInput(value, min, max, onChange) {
    const input = document.createElement('input');
    input.type = 'number'; input.min = min; input.max = max; input.value = value;
    input.addEventListener('change', () => onChange(parseInt(input.value) || min));
    return input;
  }

  _rangeInput(value, min, max, onChange) {
    const input = document.createElement('input');
    input.type = 'range'; input.min = min; input.max = max; input.value = value;
    input.addEventListener('input', () => onChange(parseInt(input.value)));
    return input;
  }

  _checkbox(value, onChange) {
    const input = document.createElement('input');
    input.type = 'checkbox'; input.checked = value;
    input.addEventListener('change', () => onChange(input.checked));
    return input;
  }
}

// ===== Menu Bar =====

export class MenuBar {
  constructor(app) {
    this.app = app;
    this._open = null;
    const dropdown = document.getElementById('menu-dropdown');

    document.querySelectorAll('.menu-item').forEach(item => {
      item.addEventListener('click', e => {
        e.stopPropagation();
        const menu = item.dataset.menu;
        if (this._open === menu) {
          this._close();
        } else {
          this._show(menu, item);
        }
      });
      item.addEventListener('mouseenter', () => {
        if (this._open) this._show(item.dataset.menu, item);
      });
    });

    document.addEventListener('click', () => this._close());
    dropdown.addEventListener('click', e => e.stopPropagation());
  }

  _close() {
    document.getElementById('menu-dropdown').classList.add('hidden');
    document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('open'));
    this._open = null;
  }

  _show(menu, anchor) {
    this._open = menu;
    document.querySelectorAll('.menu-item').forEach(m =>
      m.classList.toggle('open', m.dataset.menu === menu));

    const items = this._getMenuItems(menu);
    const dropdown = document.getElementById('menu-dropdown');
    dropdown.innerHTML = '';
    dropdown.classList.remove('hidden');

    const rect = anchor.getBoundingClientRect();
    dropdown.style.left = rect.left + 'px';
    dropdown.style.top = rect.bottom + 'px';

    for (const item of items) {
      if (item.sep) {
        const sep = document.createElement('div');
        sep.className = 'menu-dropdown-sep';
        dropdown.appendChild(sep);
        continue;
      }
      const el = document.createElement('div');
      el.className = 'menu-dropdown-item';
      el.innerHTML = `<span>${item.label}</span>` +
        (item.shortcut ? `<span class="shortcut">${item.shortcut}</span>` : '');
      el.addEventListener('click', () => {
        this._close();
        item.action();
      });
      dropdown.appendChild(el);
    }
  }

  _getMenuItems(menu) {
    const app = this.app;
    switch (menu) {
      case 'file': return [
        { label: 'New...', shortcut: 'Ctrl+N', action: () => app.showNewDialog() },
        { label: 'Open...', shortcut: 'Ctrl+O', action: () => app.openFile() },
        { sep: true },
        { label: 'Save', shortcut: 'Ctrl+S', action: () => app.saveFile() },
        { label: 'Save As...', shortcut: 'Ctrl+Shift+S', action: () => app.saveFileAs() },
        { sep: true },
        { label: 'Save Project (.gbp)', action: () => app.saveProject() },
        { label: 'Open Project (.gbp)', action: () => app.openProject() },
        { sep: true },
        { label: 'Close', shortcut: 'Ctrl+W', action: () => bus.emit('doc:close') },
        { sep: true },
        { label: 'Split Sprite Sheet → Layers', action: () => app.splitSpriteSheet() },
        { label: 'Export Layers → Sprite Sheet', action: () => app.exportSpriteSheet() },
      ];
      case 'edit': return [
        { label: 'Undo', shortcut: 'Ctrl+Z', action: () => app.undo() },
        { label: 'Redo', shortcut: 'Ctrl+Shift+Z', action: () => app.redo() },
        { sep: true },
        { label: 'Cut', shortcut: 'Ctrl+X', action: () => app.cutSelection() },
        { label: 'Copy', shortcut: 'Ctrl+C', action: () => app.copySelection() },
        { label: 'Paste', shortcut: 'Ctrl+V', action: () => app.pasteFromClipboard() },
        { sep: true },
        { label: 'Select All', shortcut: 'Ctrl+A', action: () => app.selectAll() },
        { label: 'Deselect', shortcut: 'Ctrl+D', action: () => app.deselect() },
      ];
      case 'image': return [
        { label: 'Flip Horizontal', action: () => app.flipHorizontal() },
        { label: 'Flip Vertical', action: () => app.flipVertical() },
        { sep: true },
        { label: 'Scale Image...', action: () => app.showScaleImageDialog() },
        { label: 'Canvas Size...', action: () => app.showCanvasSizeDialog() },
        { label: 'Crop to Selection', action: () => app.cropToSelection() },
        { sep: true },
        { label: 'Flatten Image', action: () => app.flattenImage() },
      ];
      case 'view': return [
        { label: 'Zoom In', shortcut: '+', action: () => app.zoomIn() },
        { label: 'Zoom Out', shortcut: '-', action: () => app.zoomOut() },
        { label: 'Fit in Window', shortcut: 'Ctrl+0', action: () => app.fitInView() },
        { label: 'Actual Size', shortcut: 'Ctrl+1', action: () => app.actualSize() },
        { sep: true },
        { label: (app.renderer.gridEnabled ? '✓ ' : '') + 'Pixel Grid', shortcut: 'Ctrl+G', action: () => bus.emit('grid:toggle') },
      ];
      default: return [];
    }
  }
}

// ===== New Image Dialog =====

export class NewImageDialog {
  constructor() {
    const preset = document.getElementById('new-preset');
    const wInput = document.getElementById('new-width');
    const hInput = document.getElementById('new-height');

    preset.addEventListener('change', () => {
      if (preset.value === 'custom') return;
      const [w, h] = preset.value.split(',');
      wInput.value = w;
      hInput.value = h;
    });

    document.getElementById('new-ok').addEventListener('click', () => this._create());
    document.getElementById('new-cancel').addEventListener('click', () => this.hide());

    // Enter key
    document.getElementById('new-image-dialog').addEventListener('keydown', e => {
      if (e.key === 'Enter') this._create();
      if (e.key === 'Escape') this.hide();
    });
  }

  async show() {
    document.getElementById('dialog-overlay').classList.remove('hidden');

    // Try to pre-fill dimensions from clipboard image
    let size = bus._lastClipboardSize || null;
    if (!size) {
      try {
        size = await window.app?.constructor?.getClipboardImageSize?.();
      } catch {}
    }
    if (size) {
      document.getElementById('new-width').value = size.width;
      document.getElementById('new-height').value = size.height;
      document.getElementById('new-preset').value = 'custom';
    }

    document.getElementById('new-width').focus();
  }

  hide() {
    document.getElementById('dialog-overlay').classList.add('hidden');
    document.activeElement?.blur();
  }

  _create() {
    const w = parseInt(document.getElementById('new-width').value) || 800;
    const h = parseInt(document.getElementById('new-height').value) || 600;
    const bg = document.getElementById('new-bg').value;
    this.hide();
    bus.emit('doc:new', w, h, 'Untitled', bg);
  }
}

// ===== Canvas Size Dialog =====

export class CanvasSizeDialog {
  constructor() {
    this._anchor = 'mc'; // middle-center

    document.querySelectorAll('#cs-anchor-grid button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#cs-anchor-grid button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._anchor = btn.dataset.anchor;
      });
    });

    document.getElementById('cs-ok').addEventListener('click', () => this._apply());
    document.getElementById('cs-cancel').addEventListener('click', () => this.hide());
    document.getElementById('cs-anchor-grid').addEventListener('keydown', e => {
      if (e.key === 'Escape') this.hide();
    });
    document.getElementById('canvas-size-dialog').addEventListener('keydown', e => {
      if (e.key === 'Enter') this._apply();
      if (e.key === 'Escape') this.hide();
    });
  }

  show(doc) {
    if (!doc) return;
    this._doc = doc;
    document.getElementById('cs-current').textContent = `${doc.width} x ${doc.height}`;
    document.getElementById('cs-width').value = doc.width;
    document.getElementById('cs-height').value = doc.height;
    // Reset anchor to center
    document.querySelectorAll('#cs-anchor-grid button').forEach(b => b.classList.remove('active'));
    document.querySelector('#cs-anchor-grid button[data-anchor="mc"]').classList.add('active');
    this._anchor = 'mc';
    document.getElementById('canvas-size-overlay').classList.remove('hidden');
    document.getElementById('cs-width').focus();
  }

  hide() {
    document.getElementById('canvas-size-overlay').classList.add('hidden');
    document.activeElement?.blur();
  }

  _apply() {
    const doc = this._doc;
    if (!doc) return;
    const newW = parseInt(document.getElementById('cs-width').value) || doc.width;
    const newH = parseInt(document.getElementById('cs-height').value) || doc.height;
    if (newW === doc.width && newH === doc.height) { this.hide(); return; }

    // Calculate offset based on anchor
    const dw = newW - doc.width;
    const dh = newH - doc.height;
    let ox = 0, oy = 0;
    const col = this._anchor[1]; // l, c, r
    const row = this._anchor[0]; // t, m, b
    if (col === 'c') ox = Math.floor(dw / 2);
    else if (col === 'r') ox = dw;
    if (row === 'm') oy = Math.floor(dh / 2);
    else if (row === 'b') oy = dh;

    doc.saveStructureState();
    doc.resizeCanvas(newW, newH, ox, oy);
    bus.emit('layers:changed');
    bus.emit('canvas:dirty');
    document.getElementById('status-size').textContent = `${doc.width} x ${doc.height}`;
    this.hide();
  }
}

// ===== Scale Image Dialog =====

export class ScaleImageDialog {
  constructor() {
    this._doc = null;
    this._aspect = 1;

    const wInput = document.getElementById('si-width');
    const hInput = document.getElementById('si-height');
    const lock = document.getElementById('si-lock');

    wInput.addEventListener('input', () => {
      if (lock.checked && this._aspect) {
        hInput.value = Math.round(parseInt(wInput.value) / this._aspect) || 1;
      }
    });
    hInput.addEventListener('input', () => {
      if (lock.checked && this._aspect) {
        wInput.value = Math.round(parseInt(hInput.value) * this._aspect) || 1;
      }
    });

    document.getElementById('si-ok').addEventListener('click', () => this._apply());
    document.getElementById('si-cancel').addEventListener('click', () => this.hide());
    document.getElementById('scale-image-dialog').addEventListener('keydown', e => {
      if (e.key === 'Enter') this._apply();
      if (e.key === 'Escape') this.hide();
    });
  }

  show(doc) {
    if (!doc) return;
    this._doc = doc;
    this._aspect = doc.width / doc.height;
    document.getElementById('si-current').textContent = `${doc.width} x ${doc.height}`;
    document.getElementById('si-width').value = doc.width;
    document.getElementById('si-height').value = doc.height;
    document.getElementById('scale-image-overlay').classList.remove('hidden');
    document.getElementById('si-width').focus();
  }

  hide() {
    document.getElementById('scale-image-overlay').classList.add('hidden');
    document.activeElement?.blur();
  }

  _apply() {
    const doc = this._doc;
    if (!doc) return;
    const newW = parseInt(document.getElementById('si-width').value) || doc.width;
    const newH = parseInt(document.getElementById('si-height').value) || doc.height;
    if (newW === doc.width && newH === doc.height) { this.hide(); return; }
    const interp = document.getElementById('si-interpolation').value;

    doc.saveStructureState();
    doc.scaleImage(newW, newH, interp);
    bus.emit('layers:changed');
    bus.emit('canvas:dirty');
    document.getElementById('status-size').textContent = `${doc.width} x ${doc.height}`;

    const vp = document.getElementById('viewport').getBoundingClientRect();
    doc.fitInView(vp.width, vp.height);
    document.getElementById('zoom-input').value = Math.round(doc.zoom * 100);
    document.getElementById('zoom-slider').value = Math.round(Math.log(doc.zoom / 0.05) / Math.log(32 / 0.05) * 100);
    this.hide();
  }
}
