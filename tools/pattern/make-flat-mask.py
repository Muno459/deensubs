"""Convert the girih star-lattice EPS into an alpha-mask PNG for CSS mask-image.

Artwork: "Golden Color Traditional Islamic Pattern" via Vecteezy (Free License)
https://www.vecteezy.com/vector-art/47131621 — attribution kept in code only
(owner decision, July 2026; see AGENTS.md).

The golden lattice is extracted by brightness (gold ~180-230 vs dark ground
~50-70), so the line-work becomes an antialiased alpha mask that CSS can tint
with each category's color. The output is a wide banner-shaped strip (band
cropped from the source, tiled sideways) so CSS `mask-size: cover` maps it
~1:1 onto the banner and the stars stay small and delicate. A rightward fade
is baked in so the pattern dissolves before the banner's right edge.

Usage:
  gs -q -dNOPAUSE -dBATCH -dEPSCrop -sDEVICE=png16m -r72 -o golden-full.png \
     src/artifacts/vecteezy_golden-color-traditional-islamic-pattern_47131621.eps
  pip install pillow numpy && python3 tools/pattern/make-flat-mask.py
"""
import numpy as np
from PIL import Image

img = Image.open("golden-full.png").convert("L")
a = np.asarray(img, dtype=np.float32)

# brightness above the dark ground becomes alpha
alpha = np.clip((a - 110) * 3.5, 0, 255).astype(np.float32)

h, w = alpha.shape
# banner-shaped strip: crop a horizontal band, tile it sideways
strip_h = 1400
top = (h - strip_h) // 2
strip = alpha[top:top + strip_h, :]
strip = np.hstack([strip, strip, strip])  # pattern is seamless
sw = strip.shape[1]

# fade to nothing across the right 45%
ramp = np.ones(sw, dtype=np.float32)
fade_w = int(sw * 0.45)
ramp[sw - fade_w:] = np.linspace(1, 0, fade_w)
strip = (strip * ramp[None, :]).astype(np.uint8)

out_w = 1800
out_h = int(strip_h * out_w / sw)
mask = Image.fromarray(strip, "L").resize((out_w, out_h), Image.LANCZOS)

white = Image.new("L", mask.size, 255)
Image.merge("LA", (white, mask)).save(
    "/Users/doflame--/deensubs/src/artifacts/pattern-flat.png", optimize=True)
print("saved pattern-flat.png", mask.size)
