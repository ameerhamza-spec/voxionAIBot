import * as fs from 'fs';
import * as wav from 'wav';

const MULAW_BIAS = 0x84; // Bias used in μ-law decoding formula

/**
 * Decode a single μ-law byte into a 16-bit PCM sample.
 * 
 * Input:
 *   - byteVal: number (8-bit μ-law encoded audio sample)
 * 
 * Output:
 *   - number (decoded 16-bit PCM sample in the range -32768 to +32767)
 */
function muLawDecodeByte(byteVal: number): number {
  byteVal = ~byteVal & 0xff; // Invert bits as per μ-law standard
  const sign = (byteVal & 0x80) ? -1 : 1; // Determine sign bit
  const exponent = (byteVal >> 4) & 0x07; // Extract exponent (3 bits)
  const mantissa = byteVal & 0x0f;        // Extract mantissa (4 bits)

  // Compute sample value
  let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
  sample = (sample - MULAW_BIAS) * sign;

  // Clamp to 16-bit PCM range
  if (sample > 32767) sample = 32767;
  if (sample < -32768) sample = -32768;

  return sample;
}

/**
 * Convert a buffer of μ-law bytes into a buffer of PCM16 samples.
 * 
 * Input:
 *   - muLawBuffer: Buffer (each byte is an 8-bit μ-law sample)
 * 
 * Output:
 *   - Buffer (PCM16 little-endian, 2 bytes per sample)
 */
function decodeMulawBufferToPCM16Buffer(muLawBuffer: Buffer): Buffer {
  const out = Buffer.alloc(muLawBuffer.length * 2); // Each μ-law byte → 2 PCM16 bytes
  for (let i = 0; i < muLawBuffer.length; i++) {
    const pcm = muLawDecodeByte(muLawBuffer[i]);
    out.writeInt16LE(pcm, i * 2); // Write little-endian 16-bit PCM
  }
  return out;
}

/**
 * Class for writing audio data to a WAV file.
 * Supports direct PCM16 input or μ-law input (auto-decoded to PCM16).
 */
export class WavWriter {
  private fileStream: fs.WriteStream; // Stream to the output file
  private wavWriter: wav.Writer;      // WAV formatter (handles headers, chunks, etc.)

  /**
   * Constructor
   * 
   * Input:
   *   - filename: string (path to output WAV file)
   * 
   * Creates a writable WAV file with:
   *   - Sample rate: 8000 Hz
   *   - Mono (1 channel)
   *   - 16-bit samples
   */
  constructor(filename: string) {
    const dir = filename.split('/').slice(0, -1).join('/') || '.';
    try { 
      fs.mkdirSync(dir, { recursive: true }); // Ensure output directory exists
    } catch (e) {
      // Directory may already exist
    }

    this.fileStream = fs.createWriteStream(filename);
    this.wavWriter = new wav.Writer({
      sampleRate: 8000,
      channels: 1,
      bitDepth: 16,
    });

    // Pipe audio data into file
    this.wavWriter.pipe(this.fileStream);
  }

  /**
   * Write raw PCM16 data directly into WAV.
   * 
   * Input:
   *   - pcm16: Buffer (little-endian 16-bit PCM samples)
   */
  write(pcm16: Buffer) {
    if (!Buffer.isBuffer(pcm16)) return;
    this.wavWriter.write(pcm16);
  }

  /**
   * Write μ-law encoded data into WAV (auto-decoded to PCM16 first).
   * 
   * Input:
   *   - muLawBuffer: Buffer (μ-law encoded samples)
   */
  writeMulaw(muLawBuffer: Buffer) {
    const pcm16 = decodeMulawBufferToPCM16Buffer(muLawBuffer);
    this.wavWriter.write(pcm16);
  }

  /**
   * Finalize and close the WAV file.
   * Ensures file headers are properly written.
   */
  end() {
    try {
      this.wavWriter.end();
      setTimeout(() => {
        try { this.fileStream.end(); } catch { }
      }, 50);
    } catch (err) {
      // Fail-safe: ignore errors during close
    }
  }
}
