import { createWriteStream } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";

const SAMPLE_RATE = 48000;
const CHANNEL_COUNT = 1;
const BITS_PER_SAMPLE = 16;
const PCM_FORMAT = 1;
const HEADER_SIZE = 44;

function createHeader(dataSize) {
  const byteRate = (SAMPLE_RATE * CHANNEL_COUNT * BITS_PER_SAMPLE) / 8;
  const blockAlign = (CHANNEL_COUNT * BITS_PER_SAMPLE) / 8;
  const buffer = Buffer.alloc(HEADER_SIZE);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(PCM_FORMAT, 20);
  buffer.writeUInt16LE(CHANNEL_COUNT, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(BITS_PER_SAMPLE, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
}

function samplesToBuffer(samples) {
  const buffer = Buffer.allocUnsafe(samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) {
    buffer.writeInt16LE(samples[index], index * 2);
  }
  return buffer;
}

export class WavFileWriter {
  constructor(filePath) {
    this.filePath = filePath;
    this.dataSize = 0;
    this.output = null;
    this.closed = false;
  }

  async init() {
    await mkdir(dirname(this.filePath), { recursive: true });
    this.output = createWriteStream(this.filePath);
    await new Promise((resolve, reject) => {
      this.output.once("open", resolve);
      this.output.once("error", reject);
    });
    this.output.write(createHeader(0));
    return this;
  }

  appendSamples(samples) {
    if (this.closed || !this.output || samples.length === 0) {
      return;
    }

    const payload = samplesToBuffer(samples);
    this.dataSize += payload.length;
    this.output.write(payload);
  }

  async close() {
    if (this.closed) {
      return;
    }

    this.closed = true;

    if (this.output) {
      await new Promise((resolve, reject) => {
        this.output.end((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }

    const handle = await open(this.filePath, "r+");
    try {
      await handle.write(createHeader(this.dataSize), 0, HEADER_SIZE, 0);
    } finally {
      await handle.close();
    }
  }
}
