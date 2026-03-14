# GrobPaint

Somewhere between MS Paint and Paint.NET. Multiplatform by default.

Paint.NET doesn't run on macOS. GrobPaint fills that gap — a lightweight image editor with layers, blend modes, and proper selection tools, built entirely with web technologies and served from a tiny Python backend.

![Python](https://img.shields.io/badge/python-3.9+-blue) ![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey) ![License](https://img.shields.io/badge/license-MIT-green)

<img width="1163" height="834" alt="GrobPaint screenshot" src="https://github.com/user-attachments/assets/6bd72530-341c-4a07-ad25-be5eb4c1ec41" />

## Features

- **Layers** — add, delete, duplicate, merge, reorder, per-layer opacity and blend modes (16 modes: Normal, Multiply, Screen, Overlay, etc.)
- **Tools** — Pencil, Brush, Eraser, Fill, Eyedropper, Line, Rectangle, Ellipse, Text, Rectangular Select, Magic Wand, Move, Rotate, Scale, Mirror
- **Selection** — rectangular and magic wand with configurable tolerance, copy/cut/paste, crop to selection, delete
- **Color** — HSV picker, RGB/Hex input, alpha channel, palette support (Lospec 500, PICO-8), swap primary/secondary
- **Canvas** — zoom (scroll wheel, pinch, keyboard), pan (space+drag, middle-click, trackpad), fit-to-view, configurable grid overlay
- **File I/O** — open/save PNG, JPEG, BMP, GIF; native project format (`.gbp`) preserves layers as a ZIP archive
- **Sprite sheets** — split a sheet into layers, or export layers as a horizontal sheet
- **Image operations** — scale (nearest/bilinear/bicubic), canvas resize with anchor, flip horizontal/vertical, flatten
- **Multi-document** — tabbed interface, multiple images open at once
- **Clipboard** — paste images directly from clipboard as new layers

## Getting started

### Run from source

```bash
python grobpaint.py
```

This launches a native window using [pywebview](https://pywebview.flowrl.com/). If pywebview isn't installed, it falls back to your default browser.

To force browser mode:

```bash
python grobpaint.py --browser
```

**Dependencies:**

- Python 3.9+
- `pywebview` (optional, for native window) — `pip install pywebview`

No npm, no bundler, no build step. The frontend is vanilla JS with ES modules.

### Build a standalone app

```bash
./build.sh
```

Produces `dist/GrobPaint.app` (macOS) or `dist/GrobPaint/GrobPaint` (binary) via PyInstaller.

### Use in browser only

You can also open `index.html` directly or serve it with any static file server. File dialogs won't be available, but the editor falls back to browser file input and download for open/save.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `P` `B` `E` `F` `I` `L` `R` `O` `T` `S` `W` `M` | Tool hotkeys |
| `[` / `]` | Decrease / increase brush size |
| `X` | Swap primary/secondary colors |
| `+` / `-` | Zoom in / out |
| `Ctrl+0` | Fit in view |
| `Ctrl+1` | Actual size (100%) |
| `Ctrl+N` | New image |
| `Ctrl+O` | Open file |
| `Ctrl+S` | Save |
| `Ctrl+Shift+S` | Save as |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | Copy / cut / paste |
| `Ctrl+A` / `Ctrl+D` | Select all / deselect |
| `Ctrl+G` | Toggle grid |
| `Delete` | Delete selection |
| `Space` + drag | Pan canvas |

## Project format

`.gbp` files are ZIP archives containing:

```
manifest.json       # dimensions, layer metadata (name, opacity, visibility, blend mode)
layers/
  layer_0.png
  layer_1.png
  ...
```

## Architecture

The app is ~2500 lines of vanilla JavaScript split across four modules:

| File | Role |
|---|---|
| `js/core.js` | EventBus, Layer, History (swap-based undo/redo), PaintDocument, Selection |
| `js/renderer.js` | Compositing engine, checkerboard background, zoom/pan, grid overlay |
| `js/tools.js` | All tools, flood fill, flood select, Bresenham line |
| `js/ui.js` | Color system, HSV picker, layers panel, document tabs, menus, dialogs |
| `js/app.js` | App init, canvas events, keyboard shortcuts, file I/O |
| `grobpaint.py` | Python HTTP server + pywebview launcher, native file dialogs |

No frameworks, no dependencies beyond one CDN include (JSZip for browser-side `.gbp` support).
