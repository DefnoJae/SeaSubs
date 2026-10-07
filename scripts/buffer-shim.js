import { Buffer } from 'buffer';
export const allocBufferUnsafe = n => { if (n > 8 * 1024 * 1024) throw new Error('Allocation limit'); return Buffer.alloc(n); };
export const bufferFrom = v => Buffer.from(v);
export const bufferConcat = v => Buffer.concat(v);
export const canAllocateBufferSize = n => n <= 2 * 1024 * 1024;
