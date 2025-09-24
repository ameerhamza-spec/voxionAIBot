import * as fs from 'fs';

export class PlaygroundWavWriter {
  private fd: number;
  private dataSize = 0;

  constructor(private filename: string, private sampleRate = 48000) {
    const dir = filename.split('/').slice(0, -1).join('/') || '.';
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
      // ignore
    }

    this.fd = fs.openSync(this.filename, 'w');
    this.writeHeader();
  }

  /**
   * Write PCM16 buffer directly into the WAV file
   */
  writePCM16(buffer: Buffer) {
    fs.writeSync(this.fd, buffer);
    this.dataSize += buffer.length;
  }

  /**
   * WAV header placeholder
   */
  private writeHeader() {
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(0, 4); // file size placeholder
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // Subchunk1 size
    header.writeUInt16LE(1, 20); // PCM format
    header.writeUInt16LE(1, 22); // Mono
    header.writeUInt32LE(this.sampleRate, 24);
    header.writeUInt32LE(this.sampleRate * 2, 28); // Byte rate
    header.writeUInt16LE(2, 32); // Block align
    header.writeUInt16LE(16, 34); // Bits per sample
    header.write('data', 36);
    header.writeUInt32LE(0, 40); // Data size placeholder
    fs.writeSync(this.fd, header);
  }

  /**
   * Finalize WAV file and update header
   */
  end() {
    const fileSize = this.dataSize + 36;
    const header = Buffer.alloc(44);

    header.write('RIFF', 0);
    header.writeUInt32LE(fileSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(this.sampleRate, 24);
    header.writeUInt32LE(this.sampleRate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(this.dataSize, 40);

    fs.writeSync(this.fd, header, 0, 44, 0);
    fs.closeSync(this.fd);
  }
}
