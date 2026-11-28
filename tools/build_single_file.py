"""Bundle the site into one shareable HTML file: dist/missing-link.html

Run from anywhere:  python3 tools/build_single_file.py
Inlines css/styles.css, js/main.js, the favicon and every image in assets/. Fonts and the films (the hero
pit stop and the showcase film) still load from the live site, so the file needs an internet connection when opened.
"""
import base64, mimetypes, os, re

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
read = lambda p: open(os.path.join(root, p), encoding='utf-8').read()
html, css, main = read('index.html'), read('css/styles.css'), read('js/main.js')
fav = base64.b64encode(open(os.path.join(root, 'assets/favicon.svg'), 'rb').read()).decode()
# the hero picks its film in script; point it at the live site
main = main.replace("'assets/hero/", "'https://mlinkm.com/assets/hero/")

def swap(a, b):
    global html
    assert a in html, f'expected to find: {a[:60]}'
    html = html.replace(a, b)


swap('<link rel="stylesheet" href="css/styles.css">', '<style>\n' + css + '\n</style>')
swap('href="assets/favicon.svg"', 'href="data:image/svg+xml;base64,' + fav + '"')
swap('<link rel="manifest" href="site.webmanifest">\n', '')
swap('<script src="js/main.js" defer></script>', '<script>\naddEventListener("DOMContentLoaded", () => {\n' + main + '\n});\n</script>')
# images become data URIs; the film is too heavy, so it streams from the live site
LIVE = 'https://mlinkm.com/'
mimetypes.add_type('image/webp', '.webp')
def inline(m):
    path = m.group(1)
    if path.endswith('.mp4'):
        return m.group(0).replace(path, LIVE + path)
    kind = mimetypes.guess_type(path)[0] or 'application/octet-stream'
    data = base64.b64encode(open(os.path.join(root, path), 'rb').read()).decode()
    return m.group(0).replace(path, f'data:{kind};base64,{data}')
html = re.sub(r'(?:src|poster)="(assets/[^"]+)"', inline, html)
assert 'js/main.js' not in html and 'css/styles.css' not in html and '"assets/' not in html

os.makedirs(os.path.join(root, 'dist'), exist_ok=True)
out = os.path.join(root, 'dist', 'missing-link.html')
open(out, 'w', encoding='utf-8').write(html)
print('wrote', out, len(html), 'bytes')
