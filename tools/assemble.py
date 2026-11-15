"""Build dist/index.html: page shell + map data + places + game, all in one file."""
import os
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
rd = lambda p: open(os.path.join(R, p), encoding='utf8').read()
html = (rd('src/shell.html') + '\n<script>\nconst MAP_DATA = ' + rd('data/map.json') + ';\nMAP_DATA.bld = ' + rd('data/buildings.json') + ';\n'
        + rd('src/words.js') + '\n' + rd('src/places.js') + '\n' + rd('src/game.js').replace('/*VIEW3D*/', rd('src/view3d.js')) + '\n</script>\n')
os.makedirs(os.path.join(R, 'dist'), exist_ok=True)
out = os.path.join(R, 'dist', 'index.html')
open(out, 'w', encoding='utf8').write(html)
print(out, len(html.encode('utf8')) // 1024, 'KB')

# standalone version (full document) for phones: install info + offline worker
import time
version = time.strftime('%Y%m%d%H%M%S')
head_extra = ('<link rel="manifest" href="manifest.webmanifest">'
              '<link rel="apple-touch-icon" href="icon-180.png">'
              '<meta name="apple-mobile-web-app-capable" content="yes">'
              '<meta name="mobile-web-app-capable" content="yes">'
              '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">'
              '<meta name="apple-mobile-web-app-title" content="Berlin">')
register = ("<script>if('serviceWorker' in navigator){navigator.serviceWorker.register('sw.js').then(function(){"
            "return navigator.serviceWorker.ready}).then(function(){window.__offlineReady=true;window.dispatchEvent(new Event('offline-ready'))}).catch(function(){})}</script>")
full = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' + head_extra +
        '<style>:root{padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}</style>'
        '</head><body>' + html + register + '</body></html>')
os.makedirs(os.path.join(R, 'docs'), exist_ok=True)
open(os.path.join(R, 'docs', 'index.html'), 'w', encoding='utf8').write(full)
open(os.path.join(R, 'docs', 'sw.js'), 'w', encoding='utf8').write(rd('src/sw.js').replace('__VERSION__', version))
print('docs/ written, offline version', version)
