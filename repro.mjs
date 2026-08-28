import { mkdir, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MultiFileWriter } from 'next/dist/lib/multi-file-writer.js';

const cacheDir = join(tmpdir(), 'nextjs-shared-cache-race-repro');
const cacheFile = join(cacheDir, 'fetch-cache-entry.json');

await mkdir(cacheDir, { recursive: true });

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

// This models a shared/network filesystem where one writeFile operation may
// become visible through multiple underlying writes before it completes.
const sharedFileSystem = {
  mkdir: (directory) => mkdir(directory, { recursive: true }),
  async writeFile(filePath, data) {
    const buffer = Buffer.from(data);
    const file = await open(filePath, 'w');

    try {
      for (let offset = 0; offset < buffer.length; offset += 4096) {
        await file.write(buffer.subarray(offset, offset + 4096));
        await sleep(1);
      }
    } finally {
      await file.close();
    }
  },
};

const makeEntry = (writer, payloadLength) =>
  JSON.stringify({
    kind: 'FETCH',
    writer,
    payload: writer.repeat(payloadLength),
  });

async function writeEntry(writer, payloadLength) {
  const fileWriter = new MultiFileWriter(sharedFileSystem);
  fileWriter.append(cacheFile, makeEntry(writer, payloadLength));
  await fileWriter.wait();
}

let parseErrors = 0;
let reading = true;

const reader = (async () => {
  while (reading) {
    try {
      JSON.parse(await readFile(cacheFile, 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        parseErrors += 1;
      }
    }
    await sleep(0);
  }
})();

for (let iteration = 0; iteration < 20; iteration += 1) {
  await Promise.all([
    writeEntry('A', 512 * 1024),
    writeEntry('B', 64 * 1024),
  ]);
}

reading = false;
await reader;

let finalWriter = 'invalid JSON';
try {
  finalWriter = JSON.parse(await readFile(cacheFile, 'utf8')).writer;
} catch {
  parseErrors += 1;
}

console.log({ parseErrors, finalWriter });

if (parseErrors === 0) {
  throw new Error('The race was not observed; rerun the script.');
}
