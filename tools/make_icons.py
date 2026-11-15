"""Draw the app icon (no image libraries needed): night ground, U-Bahn line stripes, a yellow traveller dot."""
import os, struct, zlib

def png(path, size):
    bg = (21, 28, 42)
    lines = [(0x22, 0x4F, 0x86), (0xDA, 0x42, 0x1E), (0x7D, 0xAD, 0x4C), (0xEB, 0x74, 0x05)]
    rows = []
    cx = cy = size / 2
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            c = bg
            # four diagonal line stripes across the lower half
            band = (x + y) / size  # 0..2
            for i, col in enumerate(lines):
                b0 = 0.86 + i * 0.13
                if b0 <= band < b0 + 0.085:
                    c = col
            d = ((x - cx) ** 2 + (y - cy * 0.86) ** 2) ** 0.5
            r = size * 0.22
            if d < r + size * 0.035:
                c = bg
            if d < r:
                c = (243, 194, 47)
            if d < r and cy * 0.86 + r * 0.12 < y < cy * 0.86 + r * 0.42 and abs(x - cx) < r * 0.7:
                c = (192, 57, 43)  # scarf
            row += bytes(c)
        rows.append(bytes(row))
    raw = b''.join(rows)
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    open(path, 'wb').write(data)

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs')
os.makedirs(out, exist_ok=True)
for s in (180, 192, 512):
    png(os.path.join(out, f'icon-{s}.png'), s)
print('icons written')
