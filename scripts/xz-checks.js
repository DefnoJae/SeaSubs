// Synchronous integrity checks for Seanime's ES2018 UI VM (no Node crypto,
// WebCrypto or BigInt). XZ CRC64 uses reflected ECMA-182 with all-ones XORs.
export function crc64(bytes) {
    let lo = -1, hi = -1;
    for (const byte of bytes) {
        lo ^= byte;
        for (let bit = 0; bit < 8; bit++) {
            const carry = lo & 1;
            lo = (lo >>> 1) | (hi << 31);
            hi >>>= 1;
            if (carry) { lo ^= 0xd7870f42; hi ^= 0xc96c5795; }
        }
    }
    lo = ~lo; hi = ~hi;
    return Uint8Array.from([lo, lo >>> 8, lo >>> 16, lo >>> 24, hi, hi >>> 8, hi >>> 16, hi >>> 24]);
}

const K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
];
const rotr = (n, bits) => (n >>> bits) | (n << (32 - bits));
export function sha256(bytes) {
    const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
    padded.set(bytes); padded[bytes.length] = 128;
    // Input is bounded to 2 MiB by the XZ reader; the high length word is zero.
    const length = bytes.length * 8;
    for (let i = 0; i < 4; i++) padded[padded.length - 1 - i] = length >>> (i * 8);
    const w = new Int32Array(64);
    for (let offset = 0; offset < padded.length; offset += 64) {
        for (let i = 0; i < 16; i++) {
            const p = offset + i * 4;
            w[i] = (padded[p] << 24) | (padded[p + 1] << 16) | (padded[p + 2] << 8) | padded[p + 3];
        }
        for (let i = 16; i < 64; i++) {
            const x = w[i - 15], y = w[i - 2];
            w[i] = w[i - 16] + (rotr(x,7) ^ rotr(x,18) ^ (x >>> 3)) + w[i - 7] + (rotr(y,17) ^ rotr(y,19) ^ (y >>> 10));
        }
        let [a,b,c,d,e,f,g,j] = h;
        for (let i = 0; i < 64; i++) {
            const t1 = (j + (rotr(e,6) ^ rotr(e,11) ^ rotr(e,25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
            const t2 = ((rotr(a,2) ^ rotr(a,13) ^ rotr(a,22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
            j=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
        }
        [a,b,c,d,e,f,g,j].forEach((v,i) => { h[i] = (h[i] + v) | 0; });
    }
    const digest = new Uint8Array(32);
    h.forEach((v,i) => { for (let j = 0; j < 4; j++) digest[i * 4 + j] = v >>> (24 - j * 8); });
    return digest;
}
