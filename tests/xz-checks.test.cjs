const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const vm = require('node:vm');
const path = require('node:path');
const esbuild = require('esbuild');
const code = esbuild.buildSync({entryPoints:[path.join(__dirname,'../scripts/xz-checks.js')],bundle:true,write:false,
    format:'iife',globalName:'checks',target:'es2018'}).outputFiles[0].text;
const sandbox={}; vm.createContext(sandbox); vm.runInContext(code,sandbox);
test('XZ CRC64 matches the standard CRC-64/XZ check vector in little endian order',()=>{
    assert.equal(Buffer.from(sandbox.checks.crc64(Buffer.from('123456789'))).toString('hex'),'fa3919dfbbc95d99');
    assert.equal(Buffer.from(sandbox.checks.crc64(Buffer.alloc(0))).toString('hex'),'0000000000000000');
});
test('synchronous SHA256 matches Node crypto across padding boundaries and maximum block size',()=>{
    for(const size of [0,1,55,56,63,64,65,119,120,127,128,129,2*1024*1024]) {
        const bytes=Buffer.alloc(size);for(let i=0;i<size;i++)bytes[i]=(i*37+11)&255;
        assert.equal(Buffer.from(sandbox.checks.sha256(bytes)).toString('hex'),crypto.createHash('sha256').update(bytes).digest('hex'));
    }
});
