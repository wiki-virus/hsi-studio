import fs from 'fs';
import { parseNpz } from './src/lib/npzParser.js';

async function run() {
  const buf = fs.readFileSync('test.npz');
  const arrays = await parseNpz(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  console.log('Parsed arrays:', Object.keys(arrays));
  
  const cube = arrays['cube'];
  console.log('Shape:', cube.shape);
  console.log('Dtype:', cube.dtype);
  console.log('Fortran Order:', cube.fortranOrder);
  console.log('ByteLength:', cube.data.byteLength);
  console.log('First 5 elements:', cube.data.slice(0, 5));
}

run().catch(console.error);
