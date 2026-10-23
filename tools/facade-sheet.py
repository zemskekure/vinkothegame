"""Contact sheet of rectified facade crops with their measured colour swatch and window rhythm, for review.

Usage: python3 tools/facade-sheet.py <out.jpg> [count] [offset]
"""

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

RAW = Path(__file__).resolve().parent.parent / 'data' / 'raw'
out, count, offset = sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 24, int(sys.argv[3]) if len(sys.argv) > 3 else 0

params = json.loads((RAW / 'facade-params.json').read_text()) if (RAW / 'facade-params.json').exists() else {}
names = sorted(p.stem for p in (RAW / 'facades').glob('*.jpg') if not p.stem.endswith('.debug'))[offset:offset + count]

H, COLS = 220, 6
tiles = []
for name in names:
    im = Image.open(RAW / 'facades' / f'{name}.jpg').convert('RGB')
    w = max(60, min(420, int(im.width * H / im.height)))
    tile = Image.new('RGB', (w, H + 46), 'white')
    tile.paste(im.resize((w, H)), (0, 0))
    d = ImageDraw.Draw(tile)
    p = params.get(name)
    label = name
    if p:
        d.rectangle([0, H + 2, 40, H + 44], fill=tuple(p['colour']))
        label += f"\nbay {p['bay']}  win {p['window']}  shop {int(p['shop'])}"
    d.text((44, H + 4), label, fill='black')
    tiles.append(tile)

rows = [tiles[i:i + COLS] for i in range(0, len(tiles), COLS)]
sheet = Image.new('RGB', (max(sum(t.width + 8 for t in r) for r in rows), len(rows) * (H + 54)), 'white')
for j, r in enumerate(rows):
    x = 0
    for t in r:
        sheet.paste(t, (x, j * (H + 54)))
        x += t.width + 8
sheet.save(out, quality=85)
print(out, len(tiles))
