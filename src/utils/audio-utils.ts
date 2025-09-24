import { spawn } from 'child_process';

/**
 * Convert μ-law (8kHz) → PCM16 48kHz mono using ffmpeg
 */
export async function mulawToPCM16(buffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-f', 'mulaw',     // input format
      '-ar', '8000',     // input sample rate
      '-ac', '1',        // mono
      '-i', 'pipe:0',    // input from stdin
      '-f', 's16le',     // output = PCM16 raw
      '-ar', '48000',    // resample to 48kHz
      '-ac', '1',        // mono
      'pipe:1',          // output to stdout
    ]);

    const chunks: Buffer[] = [];
    ffmpeg.stdout.on('data', (c) => chunks.push(c));
    ffmpeg.on('close', () => resolve(Buffer.concat(chunks)));
    ffmpeg.on('error', reject);

    ffmpeg.stdin.write(buffer);
    ffmpeg.stdin.end();
  });
}
