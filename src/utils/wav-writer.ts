import * as fs from 'fs';
import * as wav from 'wav';

const MULAW_BIAS = 0x84;

function muLawDecodeByte(byteVal: number): number {
  byteVal = ~byteVal & 0xff;
  const sign = (byteVal & 0x80) ? -1 : 1;
  const exponent = (byteVal >> 4) & 0x07;
  const mantissa = byteVal & 0x0f;
  let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
  sample = (sample - MULAW_BIAS) * sign;
  if (sample > 32767) sample = 32767;
  if (sample < -32768) sample = -32768;
  return sample;
}

function decodeMulawBufferToPCM16Buffer(muLawBuffer: Buffer): Buffer {
  const out = Buffer.alloc(muLawBuffer.length * 2);
  for (let i = 0; i < muLawBuffer.length; i++) {
    const pcm = muLawDecodeByte(muLawBuffer[i]);
    out.writeInt16LE(pcm, i * 2);
  }
  return out;
}

export class WavWriter {
  private fileStream: fs.WriteStream;
  private wavWriter: wav.Writer;

  constructor(filename: string) {
    const dir = filename.split('/').slice(0, -1).join('/') || '.';
    try { 
      fs.mkdirSync(dir, { recursive: true }); 
    } catch (e) {
      // Directory might already exist
    }

    this.fileStream = fs.createWriteStream(filename);
    this.wavWriter = new wav.Writer({
      sampleRate: 8000,
      channels: 1,
      bitDepth: 16,
    });
    this.wavWriter.pipe(this.fileStream);
  }

  write(pcm16: Buffer) {
    if (!Buffer.isBuffer(pcm16)) return;
    this.wavWriter.write(pcm16);
  }

  writeMulaw(muLawBuffer: Buffer) {
    const pcm16 = decodeMulawBufferToPCM16Buffer(muLawBuffer);
    this.wavWriter.write(pcm16);
  }

  end() {
    try {
      this.wavWriter.end();
      setTimeout(() => {
        try { this.fileStream.end(); } catch { }
      }, 50);
    } catch (err) {
      // best-effort
    }
  }
}