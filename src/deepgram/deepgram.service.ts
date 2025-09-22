import { Injectable, Logger } from '@nestjs/common';
import WebSocket from 'ws';

@Injectable()
export class DeepgramService {
    private readonly logger = new Logger(DeepgramService.name);
    private readonly apiKey = process.env.DEEPGRAM_API_KEY; // 🔑 Deepgram API key from environment
    private readonly baseUrl = 'wss://api.deepgram.com/v1/listen'; // 🎙️ Deepgram WebSocket endpoint

    /**
     * Creates a live WebSocket connection to Deepgram for speech-to-text transcription.
     * @param onTranscript Callback function to handle incoming transcription data from Deepgram.
     * @returns A Promise that resolves with an active WebSocket connection to Deepgram.
     */
    async createLive(
        onTranscript: (data: any) => void,
    ): Promise<WebSocket> {
        return new Promise((resolve, reject) => {
            // 🌐 Full URL with audio config: μ-law, 8kHz, mono (Twilio standard for calls)
            const url = `${this.baseUrl}?encoding=mulaw&sample_rate=8000&channels=1`;

            // 🔗 Create a WebSocket connection to Deepgram with API auth
            const ws = new WebSocket(url, {
                headers: { Authorization: `Token ${this.apiKey}` },
            });

            // ✅ On successful connection
            ws.on('open', () => {
                this.logger.log('Deepgram live connection open');
                resolve(ws); // return the WebSocket so caller can send audio
            });

            // 🎧 On receiving messages (transcription results)
            ws.on('message', (msg: any) => {
                try {
                    const data = JSON.parse(msg.toString()); // Parse JSON payload
                    if (data?.channel?.alternatives) {
                        // Forward transcription result to provided callback
                        onTranscript(data);
                    }
                } catch (err: any) {
                    this.logger.error(`Deepgram message parse error: ${err.message}`);
                }
            });

            // ❌ Handle connection errors
            ws.on('error', (err) => {
                this.logger.error(`Deepgram WS error: ${err.message}`);
                reject(err); // fail the Promise if error happens
            });

            // 🔒 Handle clean disconnection
            ws.on('close', () => {
                this.logger.log('Deepgram connection closed');
            });
        });
    }
}







