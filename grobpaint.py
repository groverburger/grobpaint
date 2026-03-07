#!/usr/bin/env python3
"""GrobPaint — A Paint.NET-like image editor."""

import argparse
import base64
import io
import json
import mimetypes
import os
import socket
import sys
import threading
import zipfile
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

# Support PyInstaller bundled mode
if getattr(sys, '_MEIPASS', None):
    DIR = Path(sys._MEIPASS)
else:
    DIR = Path(__file__).parent


def find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        return s.getsockname()[1]


def file_dialog_open(filetypes=None):
    """Show a native file-open dialog. Returns path or None."""
    try:
        import webview
        result = webview.windows[0].create_file_dialog(
            webview.OPEN_DIALOG,
            file_types=filetypes or ("Image Files (*.png;*.jpg;*.jpeg;*.bmp;*.gif)",
                                     "GrobPaint Project (*.gbp)",
                                     "All Files (*.*)"),
        )
        return result[0] if result else None
    except Exception:
        pass
    # tkinter fallback
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        ft = [("Image Files", "*.png *.jpg *.jpeg *.bmp *.gif"),
              ("GrobPaint Project", "*.gbp"),
              ("All Files", "*.*")]
        path = filedialog.askopenfilename(filetypes=ft)
        root.destroy()
        return path or None
    except Exception:
        return None


def file_dialog_save(filetypes=None, default_ext=None, default_name=None):
    """Show a native file-save dialog. Returns path or None."""
    ext = default_ext or ".png"
    # Ensure the default name has the right extension
    if default_name:
        stem, existing_ext = os.path.splitext(default_name)
        if not existing_ext:
            default_name = stem + ext
    try:
        import webview
        result = webview.windows[0].create_file_dialog(
            webview.SAVE_DIALOG,
            file_types=filetypes or ("PNG Image (*.png)",
                                     "JPEG Image (*.jpg)",
                                     "BMP Image (*.bmp)",
                                     "All Files (*.*)"),
            save_filename=default_name or "",
        )
        return result if isinstance(result, str) else (result[0] if result else None)
    except Exception:
        pass
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        if filetypes:
            # Convert pywebview format "Desc (*.ext)" to tkinter [("Desc", "*.ext")]
            import re
            ft = []
            for entry in filetypes:
                if isinstance(entry, tuple) and len(entry) == 2:
                    ft.append(entry)
                else:
                    m = re.match(r"(.+?)\s*\((\*\.\w+)\)", entry)
                    ft.append((m.group(1).strip(), m.group(2)) if m else ("All Files", "*.*"))
        else:
            ft = [("PNG Image", "*.png"), ("JPEG Image", "*.jpg"),
                  ("BMP Image", "*.bmp"), ("All Files", "*.*")]
        path = filedialog.asksaveasfilename(
            filetypes=ft, defaultextension=ext,
            initialfile=default_name or "")
        root.destroy()
        return path or None
    except Exception:
        return None


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIR), **kwargs)

    def log_message(self, fmt, *args):
        pass  # suppress logs

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b""

        if self.path == "/api/ping":
            self._json_response({"ok": True})
        elif self.path == "/api/file/open":
            self._handle_file_open()
        elif self.path == "/api/file/save":
            self._handle_file_save(body)
        elif self.path == "/api/project/open":
            self._handle_project_open()
        elif self.path == "/api/project/save":
            self._handle_project_save(body)
        else:
            self._json_response({"error": "Not found"}, 404)

    def _json_response(self, data, code=200):
        payload = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(payload))
        self.end_headers()
        self.wfile.write(payload)

    def _handle_file_open(self):
        path = file_dialog_open()
        if not path:
            self._json_response({"cancelled": True})
            return
        try:
            with open(path, "rb") as f:
                data = base64.b64encode(f.read()).decode()
            ext = os.path.splitext(path)[1].lower()
            mime = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
                    "bmp": "image/bmp", "gif": "image/gif"}.get(ext.lstrip("."), "image/png")
            self._json_response({
                "data": f"data:{mime};base64,{data}",
                "name": os.path.basename(path),
                "path": path,
            })
        except Exception as e:
            self._json_response({"error": str(e)}, 500)

    def _handle_file_save(self, body):
        req = json.loads(body)
        path = req.get("path")
        if not path:
            path = file_dialog_save(default_ext=req.get("ext", ".png"),
                                    default_name=req.get("defaultName"))
        if not path:
            self._json_response({"cancelled": True})
            return
        try:
            b64 = req["data"].split(",", 1)[1] if "," in req["data"] else req["data"]
            with open(path, "wb") as f:
                f.write(base64.b64decode(b64))
            self._json_response({"path": path, "name": os.path.basename(path)})
        except Exception as e:
            self._json_response({"error": str(e)}, 500)

    def _handle_project_open(self):
        path = file_dialog_open(
            filetypes=("GrobPaint Project (*.gbp)", "All Files (*.*)"))
        if not path:
            self._json_response({"cancelled": True})
            return
        try:
            with zipfile.ZipFile(path, "r") as zf:
                manifest = json.loads(zf.read("manifest.json"))
                layers = []
                for layer_info in manifest["layers"]:
                    png_data = zf.read(f"layers/{layer_info['file']}")
                    b64 = base64.b64encode(png_data).decode()
                    layers.append({
                        **layer_info,
                        "data": f"data:image/png;base64,{b64}",
                    })
            self._json_response({
                "manifest": manifest,
                "layers": layers,
                "name": os.path.basename(path),
                "path": path,
            })
        except Exception as e:
            self._json_response({"error": str(e)}, 500)

    def _handle_project_save(self, body):
        req = json.loads(body)
        path = req.get("path")
        if not path:
            path = file_dialog_save(
                filetypes=("GrobPaint Project (*.gbp)",),
                default_ext=".gbp",
                default_name=req.get("defaultName"))
        if not path:
            self._json_response({"cancelled": True})
            return
        try:
            manifest = req["manifest"]
            with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
                zf.writestr("manifest.json", json.dumps(manifest, indent=2))
                for layer in req["layers"]:
                    b64 = layer["data"].split(",", 1)[1] if "," in layer["data"] else layer["data"]
                    zf.writestr(f"layers/{layer['file']}", base64.b64decode(b64))
            self._json_response({"path": path, "name": os.path.basename(path)})
        except Exception as e:
            self._json_response({"error": str(e)}, 500)


def main():
    parser = argparse.ArgumentParser(description="GrobPaint Image Editor")
    parser.add_argument("--browser", action="store_true", help="Open in browser instead of native window")
    parser.add_argument("--port", type=int, default=0, help="Port (0=auto)")
    args = parser.parse_args()

    port = args.port or find_free_port()
    server = HTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}"

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    if args.browser:
        import webbrowser
        print(f"GrobPaint running at {url}")
        webbrowser.open(url)
        try:
            thread.join()
        except KeyboardInterrupt:
            pass
    else:
        try:
            import webview
            webview.create_window("GrobPaint", url, width=1400, height=900,
                                 min_size=(900, 600))
            webview.start()
        except ImportError:
            import webbrowser
            print(f"pywebview not installed, opening in browser: {url}")
            webbrowser.open(url)
            try:
                thread.join()
            except KeyboardInterrupt:
                pass

    server.shutdown()


if __name__ == "__main__":
    main()
