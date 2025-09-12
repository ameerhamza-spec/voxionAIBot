import { Injectable, Logger } from '@nestjs/common';
import WebSocket from 'ws';

@Injectable()
export class DeepgramService {
    private readonly logger = new Logger(DeepgramService.name);
    private readonly apiKey = process.env.DEEPGRAM_API_KEY;
    private readonly baseUrl = 'wss://api.deepgram.com/v1/listen';

    async createLive(
        onTranscript: (data: any) => void,
    ): Promise<WebSocket> {
        return new Promise((resolve, reject) => {
            const url = `${this.baseUrl}?encoding=mulaw&sample_rate=8000&channels=1`;
            const ws = new WebSocket(url, {
                headers: { Authorization: `Token ${this.apiKey}` },
            });

            ws.on('open', () => {
                this.logger.log('Deepgram live connection open');
                resolve(ws);
            });

            ws.on('message', (msg: any) => {
                try {
                    const data = JSON.parse(msg.toString());
                    if (data?.channel?.alternatives) onTranscript(data);
                } catch (err: any) {
                    this.logger.error(`Deepgram message parse error: ${err.message}`);
                }
            });

            ws.on('error', (err) => {
                this.logger.error(`Deepgram WS error: ${err.message}`);
                reject(err);
            });

            ws.on('close', () => {
                this.logger.log('Deepgram connection closed');
            });
        });
    }
}