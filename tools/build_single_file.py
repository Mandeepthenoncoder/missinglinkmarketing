"""Bundle the site into one shareable HTML file: dist/missing-link.html

Run from anywhere:  python3 tools/build_single_file.py
Inlines css/styles.css, js/scene.js + js/main.js and the favicon. Three.js, GSAP and fonts still load
from their CDNs, so the file needs an internet connection when opened.
"""
import base64, os

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
read = lambda p: open(os.path.join(root, p), encoding='utf-8').read()
html, css, scene, main = read('index.html'), read('css/styles.css'), read('js/scene.js'), read('js/main.js')
fav = base64.b64encode(open(os.path.join(root, 'assets/favicon.svg'), 'rb').read()).decode()

lines = scene.splitlines()
imports = [l for l in lines if l.startswith('import ')]
body = '\n'.join(l for l in lines if not l.startswith('import ')).replace('export function createChainScene', 'function createChainScene')
# the scene keeps its own helpers in its own scope so they never clash with main.js
scene_block = 'const createChainScene = (() => {\n' + body + '\nreturn createChainScene;\n})();'
main = main.replace("import { createChainScene } from './scene.js';\n", '')
bundle = '\n'.join(imports) + '\n\n' + scene_block + '\n\n' + main


def swap(a, b):
    global html
    assert a in html, f'expected to find: {a[:60]}'
    html = html.replace(a, b)


swap('<link rel="stylesheet" href="css/styles.css">', '<style>\n' + css + '\n</style>')
swap('href="assets/favicon.svg"', 'href="data:image/svg+xml;base64,' + fav + '"')
swap('<link rel="manifest" href="site.webmanifest">\n', '')
swap('<script type="module" src="js/main.js"></script>', '<script type="module">\n' + bundle + '\n</script>')
assert 'js/main.js' not in html and 'css/styles.css' not in html and 'assets/' not in html

os.makedirs(os.path.join(root, 'dist'), exist_ok=True)
out = os.path.join(root, 'dist', 'missing-link.html')
open(out, 'w', encoding='utf-8').write(html)
print('wrote', out, len(html), 'bytes')
