#!/usr/bin/env python3
"""Converts an avatar pack's mouth frames from version 1 (frames/crop_NNN.png + frames/alpha_NNN.png) to version 2:
one frames.pack of WebP images (quality 90) and manifest.json version 2 (docs/AVATAR-PACK.md of the SDK).

  python3 scripts/pack-frames.py <pack dir> [<pack dir> ...]     e.g. avatars/marine/normal avatars/marine/angry

Deterministic: the same PNG files give the same frames.pack bytes (Pillow's libwebp, method 6, single thread).
The PNG files are removed once the pack is written and checked (every frame decodes, sizes match the PNGs).
Needs Pillow with WebP support.
"""
import hashlib
import io
import json
import os
import struct
import sys

from PIL import Image

QUALITY = 90
MAGIC = b'ZLFPACK1'


def webp(im: Image.Image) -> bytes:
    b = io.BytesIO()
    im.save(b, 'WEBP', quality=QUALITY, method=6, exact=False)
    return b.getvalue()


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def pack_dir(d: str) -> None:
    mf = os.path.join(d, 'manifest.json')
    m = json.load(open(mf, encoding='utf-8'))
    if m.get('version') != 1 or m.get('frames'):
        print(f'{d}: already version {m.get("version")}, skipped')
        return
    n = m['source_frames']
    images = []
    for u in range(n):
        crop = Image.open(os.path.join(d, 'frames', f'crop_{u:03d}.png')).convert('RGB')
        alpha = Image.open(os.path.join(d, 'frames', f'alpha_{u:03d}.png')).convert('L')
        x0, y0, x1, y1 = m['geo'][str(u)]['crop_box']
        rw, rh = m['geo'][str(u)]['rect'][2:4]
        if crop.size != (x1 - x0, y1 - y0) or alpha.size != (rw, rh):
            raise SystemExit(f'{d}: frame {u} size does not match its geometry')
        images.append((webp(crop), webp(alpha), crop.size, alpha.size))
    # the index length depends on the offsets and the offsets on the index length: repeat until they agree
    head = 0
    while True:
        frames, o = [], 12 + head
        for c, a, _, _ in images:
            frames.append([o, len(c), o + len(c), len(a)])
            o += len(c) + len(a)
        index = json.dumps({'type': 'image/webp', 'frames': frames}, separators=(',', ':')).encode()
        if len(index) == head:
            break
        head = len(index)
    data = MAGIC + struct.pack('<I', len(index)) + index + b''.join(c + a for c, a, _, _ in images)
    # check: every image decodes to its PNG's size
    for u, (f, (_, _, cs, as_)) in enumerate(zip(frames, images)):
        if Image.open(io.BytesIO(data[f[0]:f[0] + f[1]])).size != cs or Image.open(io.BytesIO(data[f[2]:f[2] + f[3]])).size != as_:
            raise SystemExit(f'{d}: frame {u} does not decode back to its size')
    with open(os.path.join(d, 'frames.pack'), 'wb') as fp:
        fp.write(data)
    files = {k: v for k, v in m['files'].items() if not k.startswith('frames/')}
    files['frames.pack'] = {'bytes': len(data), 'sha256': sha(data)}
    m['version'] = 2
    m['files'] = files
    m['frames'] = {'pack': 'frames.pack', 'type': 'image/webp'}
    json.dump(m, open(mf, 'w', encoding='utf-8'), separators=(',', ':'), ensure_ascii=False)
    for u in range(n):
        os.remove(os.path.join(d, 'frames', f'crop_{u:03d}.png'))
        os.remove(os.path.join(d, 'frames', f'alpha_{u:03d}.png'))
    if not os.listdir(os.path.join(d, 'frames')):
        os.rmdir(os.path.join(d, 'frames'))
    print(f'{d}: {n} frames, frames.pack {len(data) / 1e6:.2f} MB, sha256 {sha(data)[:12]}')


if __name__ == '__main__':
    for d in sys.argv[1:]:
        pack_dir(d.rstrip('/'))
