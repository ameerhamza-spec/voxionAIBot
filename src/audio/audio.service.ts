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
        // 🔗 Call Deepgram's TTS API with μ-law @ 8kHz (Twilio standard format)
        const response = await fetch(
            'https://api.deepgram.com/v1/speak?encoding=mulaw&sample_rate=8000',
            {
                method: 'POST',
                headers: {
                    Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`, // API key from env
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ text }), // The actual text to convert
            },
        );

        // ❌ Error handling if Deepgram fails
        if (!response.ok) {
            throw new Error(
                `Deepgram TTS failed: ${response.status} ${response.statusText}`,
            );
        }

        // 📥 Get audio as binary data
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // 🔄 Convert binary μ-law audio into Base64 string
        return buffer.toString('base64'); // ✅ Twilio requires base64 audio frames
    }

    /**
     * Saves a Base64-encoded μ-law audio string to a `.wav` (or raw) file.
     * 
     * @param base64Mulaw Base64 audio string (from textToAudio or Twilio).
     * @param filename The name of the file to save (inside /recordings folder).
     * @returns The absolute file path where the audio was saved.
     */
    async saveAudioToFile(base64Mulaw: string, filename: string) {
        // 🔄 Decode Base64 into raw bytes
        const buffer = Buffer.from(base64Mulaw, 'base64');
        // 📂 Save file inside "recordings" folder
        const outPath = path.join('recordings', filename);

        fs.writeFileSync(outPath, buffer); // Write file to disk
        return outPath; // Return saved file path
    }
}
