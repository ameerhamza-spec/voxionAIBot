// src/audio/audio.service.ts
import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class AudioService {
    async textToAudio(text: string): Promise<string> {
        const response = await fetch(
            'https://api.deepgram.com/v1/speak?encoding=mulaw&sample_rate=8000',
            {
                method: 'POST',
                headers: {
                    Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
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

        return buffer.toString('base64'); // ✅ Twilio expects mulaw base64
    }

    async saveAudioToFile(base64Mulaw: string, filename: string) {
        const buffer = Buffer.from(base64Mulaw, 'base64');
        const outPath = path.join('recordings', filename);

        fs.writeFileSync(outPath, buffer);
        return outPath;
    }



}