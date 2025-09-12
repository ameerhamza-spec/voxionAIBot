import { Injectable, Logger } from '@nestjs/common';
import WebSocket from 'ws';

@Injectable()
export class PlaygroundDeepgramService {
  private readonly logger = new Logger(PlaygroundDeepgramService.name);
  private readonly apiKey = process.env.DEEPGRAM_API_KEY;

  async createLive(
    onTranscript: (transcript: string) => void,
    sampleRate = 16000
  ): Promise<WebSocket> {
    if (!this.apiKey) {
      throw new Error('DEEPGRAM_API_KEY is not defined');
    }

    const url = `wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=${sampleRate}&channels=1&interim_results=true`;
    this.logger.log(`Connecting to Deepgram with sample_rate=${sampleRate}`);
    const ws = new WebSocket(url, {
      headers: {
        Authorization: `Token ${this.apiKey}`,
      },
    });

    ws.on('open', () => {
      this.logger.log('Deepgram connection opened');
    });

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const str = data.toString();
        const obj = JSON.parse(str);
        this.logger.debug('Deepgram message received: ' + JSON.stringify(obj).slice(0,200));
        if (obj.is_final && obj.channel?.alternatives && obj.channel.alternatives[0].transcript) {
          const transcript = obj.channel.alternatives[0].transcript;
          onTranscript(transcript);
        }
      } catch (err) {
        this.logger.error('Deepgram message parse error', err as any);
      }
    });

    ws.on('error', (err) => {
      this.logger.error('Deepgram socket error', err as any);
    });

    ws.on('close', (code, reason) => {
      this.logger.log(`Deepgram socket closed: ${code} – ${reason?.toString() ?? ''}`);
    });

    return ws;
  }
}
