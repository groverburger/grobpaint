# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path

ROOT = Path(SPECPATH)

a = Analysis(
    ['grobpaint.py'],
    pathex=[],
    binaries=[],
    datas=[
        (str(ROOT / 'index.html'), '.'),
        (str(ROOT / 'style.css'), '.'),
        (str(ROOT / 'js'), 'js'),
    ],
    hiddenimports=['webview'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='GrobPaint',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    icon=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='GrobPaint',
)

app = BUNDLE(
    coll,
    name='GrobPaint.app',
    bundle_identifier='com.grobpaint.app',
)
