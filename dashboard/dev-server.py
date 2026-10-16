#!/usr/bin/env python3
# Dev-only server: a no-cache static file server (see below) PLUS a small live relay to
# Home Assistant for the shopping-list widget. Everything else in this project is a cron-
# fetched static snapshot; this one widget needs live reads and writes (adding an item from
# the kiosk's own touchscreen), so unlike calendar.ics/weather.json this can't just be a
# file on disk -- something has to be running to make the authenticated HA call on demand.
#
# Cache-Control: no-store on every response: the frame's WebView caches each linked
# resource (style.css, app.js, ...) independently by its own URL, not tied to the page's
# URL at all -- cache-busting the page's URL on reload doesn't touch them, and it's easy to
# end up editing a file, reloading, and silently looking at a stale cached version with no
# indication anything's wrong.
#
# Not meant for the real deployment as-is -- wherever this ends up hosted needs something
# equivalent running continuously (this script works fine as that, or port the two HA
# routes to whatever that host actually runs). The static-file serving can be anything
# once there's no HA widget to support; the HA relay specifically needs a live process.
import datetime
import http.server
import json
import urllib.request
import urllib.error
import urllib.parse

HA_CONFIG_FILE = 'ha.local.json'

def ha_config():
    with open(HA_CONFIG_FILE) as f:
        return json.load(f)

def ha_call(domain, service, body, return_response=False):
    cfg = ha_config()
    url = cfg['url'] + '/api/services/' + domain + '/' + service
    if return_response:
        url += '?return_response'
    req = urllib.request.Request(url, method='POST',
        data=json.dumps(body).encode(),
        headers={
            'Authorization': 'Bearer ' + cfg['token'],
            'Content-Type': 'application/json',
        })
    with urllib.request.urlopen(req, timeout=5) as res:
        return json.loads(res.read().decode())

def ha_get_state(entity_id):
    cfg = ha_config()
    req = urllib.request.Request(cfg['url'] + '/api/states/' + entity_id,
        headers={'Authorization': 'Bearer ' + cfg['token']})
    with urllib.request.urlopen(req, timeout=5) as res:
        return json.loads(res.read().decode())

# input_datetime-backed "last done X days ago, tap to reset" widgets -- /api/<name> reads
# days-since, /api/<name>/<action> resets it to now. Route name maps to the config key
# holding that tracker's entity_id in ha.local.json.
TRACKERS = {
    'litter': ('litter_entity_id', 'scoop'),
    'fish': ('fish_entity_id', 'fed'),
}

class NoStoreHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def send_json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/api/shopping-list':
            try:
                entity_id = ha_config()['entity_id']
                result = ha_call('todo', 'get_items', {'entity_id': entity_id}, return_response=True)
                items = result['service_response'][entity_id]['items']
                self.send_json(200, {'items': items})
            except Exception as e:
                self.send_json(502, {'error': str(e)})
            return
        for name, (entity_key, action) in TRACKERS.items():
            if self.path != '/api/' + name:
                continue
            try:
                cfg = ha_config()
                attrs = ha_get_state(cfg[entity_key])['attributes']
                # Calendar-day difference, not elapsed-time // 86400 -- something logged
                # yesterday at 11pm and checked at 9am today is only ~10h ago, which would
                # floor to 0 ("today") even though it should read "yesterday".
                done = datetime.date(attrs['year'], attrs['month'], attrs['day'])
                days_ago = (datetime.date.today() - done).days
                self.send_json(200, {'days_ago': days_ago})
            except Exception as e:
                self.send_json(502, {'error': str(e)})
            return
        if self.path == '/api/dog-fed':
            try:
                cfg = ha_config()
                entity_id = cfg.get('dog_fed_entity_id')
                if not entity_id:
                    self.send_json(200, {'configured': False})
                    return
                state = ha_get_state(entity_id)
                self.send_json(200, {'configured': True, 'state': state['state']})
            except Exception as e:
                self.send_json(502, {'error': str(e)})
            return
        super().do_GET()

    def do_POST(self):
        if self.path == '/api/shopping-list':
            length = int(self.headers.get('Content-Length', 0))
            try:
                body = json.loads(self.rfile.read(length))
                item = (body.get('item') or '').strip()
                if not item:
                    self.send_json(400, {'error': 'empty item'})
                    return
                entity_id = ha_config()['entity_id']
                ha_call('todo', 'add_item', {'entity_id': entity_id, 'item': item})
                self.send_json(200, {'ok': True})
            except Exception as e:
                self.send_json(502, {'error': str(e)})
            return
        for name, (entity_key, action) in TRACKERS.items():
            if self.path != '/api/' + name + '/' + action:
                continue
            try:
                cfg = ha_config()
                now_str = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                ha_call('input_datetime', 'set_datetime',
                    {'entity_id': cfg[entity_key], 'datetime': now_str})
                self.send_json(200, {'ok': True})
            except Exception as e:
                self.send_json(502, {'error': str(e)})
            return
        self.send_json(404, {'error': 'not found'})

    def do_DELETE(self):
        if self.path.startswith('/api/shopping-list?'):
            query = urllib.parse.parse_qs(self.path.split('?', 1)[1])
            uid = (query.get('uid') or [''])[0]
            if not uid:
                self.send_json(400, {'error': 'missing uid'})
                return
            try:
                entity_id = ha_config()['entity_id']
                ha_call('todo', 'remove_item', {'entity_id': entity_id, 'item': uid})
                self.send_json(200, {'ok': True})
            except Exception as e:
                self.send_json(502, {'error': str(e)})
            return
        self.send_json(404, {'error': 'not found'})

if __name__ == '__main__':
    http.server.test(HandlerClass=NoStoreHandler, port=8765)
