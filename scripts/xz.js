import { Buffer } from 'buffer';
import { decodeLzma2 } from 'xz-compat/dist/esm/lzma/sync/Lzma2Decoder.js';

// Subtitle-only XZ reader: CRC32, LZMA2, at most 16 blocks, 2 MB output,
// 8 MB dictionary. Reject other filters/checks instead of guessing.
const LIMIT = 2 * 1024 * 1024;
function crc(b) {
    let n = 0xffffffff;
    for (const v of b) { n ^= v; for (let j = 0; j < 8; j++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0); }
    return (n ^ 0xffffffff) >>> 0;
}
function requireOk(ok, message) { if (!ok) throw new Error('XZ: ' + message); }
export function decode(raw) {
    requireOk(raw && raw.length >= 32 && raw.length <= 2 * 1024 * 1024, 'input size');
    const b = Buffer.from(raw);
    requireOk(b.slice(0, 6).toString('hex') === 'fd377a585a00' && b[6] === 0 && b[7] === 1, 'only CRC32 streams supported');
    requireOk(crc(b.slice(6, 8)) === b.readUInt32LE(8), 'header checksum');
    const footer = b.length - 12;
    requireOk(b.slice(-2).toString() === 'YZ' && b[footer + 8] === 0 && b[footer + 9] === 1, 'footer');
    requireOk(crc(b.slice(footer + 4, footer + 10)) === b.readUInt32LE(footer), 'footer checksum');
    const index = footer - (b.readUInt32LE(footer + 4) + 1) * 4;
    requireOk(index >= 12 && index < footer - 4 && b[index] === 0, 'index');
    requireOk(crc(b.slice(index, footer - 4)) === b.readUInt32LE(footer - 4), 'index checksum');
    let pos = index + 1;
    function vli(end) {
        let n = 0, mul = 1;
        for (let i = 0; i < 5; i++) {
            requireOk(pos < end, 'truncated integer');
            const v = b[pos++]; n += (v & 127) * mul;
            if (!(v & 128)) return n;
            mul *= 128;
        }
        throw new Error('XZ: integer limit');
    }
    const count = vli(footer - 4);
    requireOk(count > 0 && count <= 16, 'block count');
    const records = []; let total = 0;
    for (let i = 0; i < count; i++) {
        const packed = vli(footer - 4), unpacked = vli(footer - 4);
        total += unpacked;
        requireOk(packed >= 8 && unpacked > 0 && total <= LIMIT, 'output limit');
        records.push({ packed, unpacked });
    }
    requireOk(b.slice(pos, footer - 4).every(v => v === 0), 'index padding');
    const chunks = []; let block = 12;
    for (const r of records) {
        const hs = (b[block] + 1) * 4, end = block + hs;
        requireOk(hs >= 8 && end < index && block + Math.ceil(r.packed / 4) * 4 <= index, 'block bounds');
        requireOk(crc(b.slice(block, end - 4)) === b.readUInt32LE(end - 4), 'block checksum');
        const flags = b[block + 1];
        requireOk((flags & 63) === 0, 'only one LZMA2 filter supported');
        pos = block + 2;
        const packedSize = flags & 64 ? vli(end - 4) : null;
        const unpackedSize = flags & 128 ? vli(end - 4) : null;
        requireOk(vli(end - 4) === 33 && vli(end - 4) === 1, 'LZMA2 filter');
        const property = b[pos++];
        requireOk(property <= 22 && pos <= end - 4 && b.slice(pos, end - 4).every(v => v === 0), 'dictionary/header limit');
        const size = r.packed - hs - 4;
        requireOk(size > 0 && (packedSize === null || packedSize === size) && (unpackedSize === null || unpackedSize === r.unpacked), 'sizes');
        const compressed = b.slice(end, end + size);
        // Validate framing before allocation; decoder's declared chunk sizes are untrusted.
        let cp = 0, outputSize = 0;
        while (cp < compressed.length) {
            const control = compressed[cp++];
            if (control === 0) { requireOk(cp === compressed.length, 'trailing LZMA2 data'); break; }
            requireOk(control === 1 || control === 2 || control >= 128, 'LZMA2 control');
            requireOk(cp + 2 <= compressed.length, 'chunk header');
            let unpack = ((compressed[cp++] << 8) | compressed[cp++]) + 1, pack = unpack;
            if (control >= 128) {
                unpack += (control & 31) * 65536;
                requireOk(cp + 2 <= compressed.length, 'compressed header');
                pack = ((compressed[cp++] << 8) | compressed[cp++]) + 1;
                if (control >= 192) { requireOk(cp < compressed.length, 'properties'); cp++; }
            }
            outputSize += unpack;
            requireOk(outputSize <= r.unpacked && cp + pack <= compressed.length, 'chunk bounds'); cp += pack;
        }
        requireOk(outputSize === r.unpacked && compressed[compressed.length - 1] === 0, 'unpacked size');
        const out = decodeLzma2(compressed, Buffer.from([property]), r.unpacked);
        const check = end + size + ((4 - ((hs + size) % 4)) % 4);
        requireOk(out.length === r.unpacked && crc(out) === b.readUInt32LE(check), 'data checksum');
        chunks.push(out); block += Math.ceil(r.packed / 4) * 4;
    }
    requireOk(block === index, 'block/index alignment');
    return Buffer.concat(chunks).toString('utf8');
}
