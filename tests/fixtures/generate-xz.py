"""Regenerate independent liblzma fixtures with Python 3 (not needed to run tests)."""
import lzma
from pathlib import Path
import struct
import zlib

root = Path(__file__).parent
text = b'[Script Info]\nTitle: XZ integrity fixture\n[Events]\n' + 'Dialogue: 0,0:00:01.00,0:00:03.00,Signs,,0,0,0,,TEST SIGN \u65e5\u672c\u8a9e\n'.encode()
(root / 'xz-subtitle.ass').write_bytes(text)

def crc(data):
    return struct.pack('<I', zlib.crc32(data))

def vli(n):
    result = bytearray()
    while n >= 128:
        result.append((n & 127) | 128)
        n >>= 7
    return bytes(result) + bytes([n])

def read_vli(data, pos):
    n = 0
    shift = 0
    while True:
        byte = data[pos]
        pos += 1
        n |= (byte & 127) << shift
        if byte < 128:
            return n, pos
        shift += 7

def multi(parts, check):
    streams = [lzma.compress(p, check=check, preset=6) for p in parts]
    blocks = bytearray()
    records = bytearray()
    for s in streams:
        index = len(s) - 12 - (struct.unpack('<I', s[-8:-4])[0] + 1) * 4
        packed, pos = read_vli(s, index + 2)
        unpacked, _ = read_vli(s, pos)
        records += vli(packed) + vli(unpacked)
        blocks += s[12:index]
    index = b'\0' + vli(len(parts)) + records
    index += b'\0' * (-len(index) % 4)
    index += crc(index)
    footer = struct.pack('<I', len(index) // 4 - 1) + streams[0][6:8]
    result = streams[0][:12] + blocks + index + crc(footer) + footer + b'YZ'
    assert lzma.decompress(result) == b''.join(parts)
    return result

for name, check in [('crc32', lzma.CHECK_CRC32), ('crc64', lzma.CHECK_CRC64), ('sha256', lzma.CHECK_SHA256)]:
    (root / ('xz-' + name + '.ass.xz')).write_bytes(lzma.compress(text, check=check, preset=6))
    (root / ('xz-' + name + '-multi.ass.xz')).write_bytes(multi([text[:53], text[53:]], check))
(root / 'xz-output-limit.xz').write_bytes(lzma.compress(b'A' * (2 * 1024 * 1024 + 1), check=lzma.CHECK_CRC64))
(root / 'xz-dictionary-limit.xz').write_bytes(lzma.compress(text, check=lzma.CHECK_SHA256, filters=[{'id': lzma.FILTER_LZMA2, 'dict_size': 16 * 1024 * 1024}]))
(root / 'xz-block-limit.xz').write_bytes(multi([text] * 17, lzma.CHECK_CRC64))
