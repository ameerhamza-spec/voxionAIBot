// src/audio/audio.service.ts
import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class AudioService {
    /**
     * Converts input text into audio using Deepgram TTS (Text-to-Speech).
     * 
     * @param text The text string you want to convert into speech.
     * @returns A Promise that resolves to a Base64-encoded μ-law audio string.
     *          (⚠️ Required format for Twilio voice streaming).
     */
    async textToAudio(text: string): Promise<string> {
        console.time('TTS Request Time'); // 🕒 Start timing

        const response = await fetch(
            'https://api.deepgram.com/v1/speak?model=aura-2-andromeda-en&encoding=mulaw&sample_rate=8000',
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

        console.timeEnd('TTS Request Time'); // 🕒 End timing and log duration

        return buffer.toString('base64'); 
    }

    async saveAudioToFile(base64Mulaw: string, filename: string) {
        const buffer = Buffer.from(base64Mulaw, 'base64');
        const outPath = path.join('recordings', filename);

        fs.writeFileSync(outPath, buffer);
        return outPath;
    }
}






