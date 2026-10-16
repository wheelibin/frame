#!/usr/bin/env python3
# Dev-only server: identical to `python3 -m http.server`, except every response gets
# Cache-Control: no-store. The frame's WebView caches each linked resource (style.css,
# app.js, ...) independently by its own URL, not tied to the page's URL at all -- cache-
# busting the page's URL on reload doesn't touch them, and it's easy to end up editing a
# file, reloading, and silently looking at a stale cached version with no indication
# anything's wrong. Not meant for the real deployment -- that's just static files, serve
# them however you like there.
import http.server

class NoStoreHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

if __name__ == '__main__':
    http.server.test(HandlerClass=NoStoreHandler, port=8765)
