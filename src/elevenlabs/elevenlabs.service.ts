// // src/elevenlabs/elevenlabs.service.ts
// import { Injectable, Logger } from '@nestjs/common';
// import axios from 'axios';

// @Injectable()
// export class ElevenLabsService {
//   private readonly logger = new Logger(ElevenLabsService.name);
//   private readonly apiKey = process.env.ELEVENLABS_API_KEY;
//   private readonly baseUrl = 'https://api.elevenlabs.io/v1/text-to-speech';
//   private readonly voiceId = 'JBFqnCBsd6RMkjVDRZzb'; // Rachel

//   async textToAudio(text: string): Promise<string> {
//     try {
//       const url = `${this.baseUrl}/${this.voiceId}?output_format=ulaw_8000`;

//       this.logger.log(`🔊 ElevenLabs TTS: ${text}`);

//       const response = await axios.post(
//         url,
//         { text },
//         {
//           headers: {
//             'xi-api-key': this.apiKey,
//             'Content-Type': 'application/json',
//             'Accept': 'audio/mulaw;rate=8000', // 👈 required for Twilio
//           },
//           responseType: 'arraybuffer',
//         },
//       );

//       return Buffer.from(response.data, 'binary').toString('base64');
//     } catch (err) {
//       this.logger.error(`❌ ElevenLabs TTS failed: ${err.message}`);
//       throw err;
//     }
//   }
// }




// src/elevenlabs/elevenlabs.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

@Injectable()
export class ElevenLabsService {
    private readonly logger = new Logger(ElevenLabsService.name);
    private readonly client: ElevenLabsClient;
    private readonly voiceId = 'JBFqnCBsd6RMkjVDRZzb'; // Rachel

    constructor() {
        this.client = new ElevenLabsClient({
            apiKey: process.env.ELEVENLABS_API_KEY,
        });
    }

    /**
     * Convert text into audio (μ-law 8000 for Twilio)
     */
    async textToAudio(text: string): Promise<string> {
        try {
            this.logger.log(`🔊 ElevenLabs SDK TTS: ${text}`);

            const stream = await this.client.textToSpeech.convert(this.voiceId, {
                text,
                modelId: 'eleven_multilingual_v2',
                outputFormat: 'ulaw_8000', // ✅ Twilio format
            });

            // Convert ReadableStream → Buffer
            const chunks: Uint8Array[] = [];
            const reader = stream.getReader();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
            }

            const audioBuffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));

            // Encode as base64 for Twilio
            return audioBuffer.toString('base64');
        } catch (err) {
            this.logger.error(`❌ ElevenLabs SDK TTS failed: ${err.message}`);
            throw err;
        }
    }
}
