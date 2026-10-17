"""Serves the game locally with browser caching turned off, so every reload picks up your edits.

Usage:
    python tools/serve.py              # http://127.0.0.1:8137 (this computer only)
    python tools/serve.py 8137 0.0.0.0 # also reachable from your phone on the same Wi-Fi
"""
import functools
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.webmanifest': 'application/manifest+json'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8137
    bind = sys.argv[2] if len(sys.argv) > 2 else '127.0.0.1'
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    handler = functools.partial(NoCacheHandler, directory=root)
    with http.server.ThreadingHTTPServer((bind, port), handler) as httpd:
        print(f'Serving {root} at http://{bind}:{port}', flush=True)
        httpd.serve_forever()


if __name__ == '__main__':
    main()
