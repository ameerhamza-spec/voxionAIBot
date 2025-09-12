import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class AudioService {
  private readonly logger = new Logger(AudioService.name);

  constructor(private readonly configService: ConfigService) {}

  async textToAudio(text: string): Promise<string> {
    const apiKey = this.configService.get<string>('deepgram.apiKey');
    
    const response = await fetch(
      'https://api.deepgram.com/v1/speak?encoding=mulaw&sample_rate=8000',
      {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      },
    );

    if (!response.ok) {
      throw new Error(
        `Deepgram TTS failed: ${response.status} ${response.statusText}`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return buffer.toString('base64');
  }

  async saveAudioToFile(base64Mulaw: string, filename: string): Promise<string> {
    const buffer = Buffer.from(base64Mulaw, 'base64');
    const recordingsDir = 'recordings';
    
    // Ensure recordings directory exists
    if (!fs.existsSync(recordingsDir)) {
      fs.mkdirSync(recordingsDir, { recursive: true });
    }
    
    const outPath = path.join(recordingsDir, filename);
    fs.writeFileSync(outPath, buffer);
    
    this.logger.log(`Audio saved to: ${outPath}`);
    return outPath;
  }
}