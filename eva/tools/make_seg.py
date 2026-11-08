#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Draws a seven-segment font of our own (no outside font): eva/app/hud/fonts/e_seg.json, digits, minus, point and space, slanted a little, the
unlit segments faintly there (dim) is not drawn: the font is the lit segments only. Same format as make_assets.py's fonts: one alpha atlas and a
rectangle for each glyph."""
import base64, json, os
from PIL import Image, ImageDraw

FONTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'hud', 'fonts')
H, GW, T, SK, OUT = 100, 56, 9, 10, None      # the cell height, a digit's width, a segment's thickness, the slant px over the height
S = 4                        # supersampling
SEG = {                      # a b c d e f g
    '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '', '.': '',
}


def hseg(d, x0, x1, y, t):
    h = t / 2
    d.polygon([(x0, y), (x0 + h, y - h), (x1 - h, y - h), (x1, y), (x1 - h, y + h), (x0 + h, y + h)], fill=255)


def vseg(d, x, y0, y1, t):
    h = t / 2
    d.polygon([(x, y0), (x + h, y0 + h), (x + h, y1 - h), (x, y1), (x - h, y1 - h), (x - h, y0 + h)], fill=255)


def glyph(ch):
    W = GW + SK + 6
    im = Image.new('L', (W * S, H * S), 0)
    d = ImageDraw.Draw(im)
    m, g = T / 2 + 3, 2.5                       # margin and gap
    x0, x1, xm = m, GW - m, None
    top, mid, bot = m, H / 2, H - m
    if ch in '.':
        d.ellipse([(GW / 2 - 5) * S, (bot - 6) * S, (GW / 2 + 5) * S, (bot + 4) * S], fill=255)
    else:
        sh = {'a': lambda: hseg(d, (x0 + g) * S, (x1 - g) * S, top * S, T * S), 'g': lambda: hseg(d, (x0 + g) * S, (x1 - g) * S, mid * S, T * S),
              'd': lambda: hseg(d, (x0 + g) * S, (x1 - g) * S, bot * S, T * S),
              'f': lambda: vseg(d, x0 * S, (top + g) * S, (mid - g) * S, T * S), 'b': lambda: vseg(d, x1 * S, (top + g) * S, (mid - g) * S, T * S),
              'e': lambda: vseg(d, x0 * S, (mid + g) * S, (bot - g) * S, T * S), 'c': lambda: vseg(d, x1 * S, (mid + g) * S, (bot - g) * S, T * S)}
        for k in SEG[ch]:
            sh[k]()
    # slant: shear x by SK px over the height (the top leans right)
    im = im.transform(im.size, Image.AFFINE, (1, SK / H, -SK * S * 0 - SK * S / 2 * 0, 0, 1, 0), resample=Image.BICUBIC)
    return im.resize((W, H), Image.LANCZOS)


def make(name, h, gw, t, sk):
    global H, GW, T, SK
    H, GW, T, SK = h, gw, t, sk
    chars = list(SEG)
    gl, x = {}, 0
    glyphs = {}
    for ch in chars:
        g = glyph(ch)
        glyphs[ch] = (x, g)
        x += g.width + 1
    atlas = Image.new('L', (x, H), 0)
    for ch, (gx, g) in glyphs.items():
        atlas.paste(g, (gx, 0))
    meta = {}
    for ch, (gx, g) in glyphs.items():
        adv = GW // 2 + 6 if ch == '.' else (GW // 2 + 4 if ch == ' ' else GW + 6)
        meta[ch] = {'x': gx, 'y': 0, 'w': g.width, 'h': H, 'ox': 0, 'advance': adv}
    with open(os.path.join(FONTS, name + '.json'), 'w') as f:
        json.dump({'source': 'drawn here (make_seg.py)', 'size': H, 'cellHeight': H, 'baseline': H - 8, 'glyphs': meta, 'width': atlas.width, 'height': atlas.height,
                   'alpha': base64.b64encode(atlas.tobytes()).decode('ascii')}, f, separators=(',', ':'))
    print(name, atlas.width, 'x', atlas.height, len(meta), 'glyphs')


make('e_seg', 100, 56, 9, 10)
make('e_segs', 56, 31, 5, 6)
