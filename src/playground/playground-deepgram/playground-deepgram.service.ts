import { Injectable, Logger } from '@nestjs/common';
import WebSocket from 'ws';

@Injectable()
export class PlaygroundDeepgramService {
  private readonly logger = new Logger(PlaygroundDeepgramService.name);
  private readonly apiKey = process.env.DEEPGRAM_API_KEY; // 🔑 API key for Deepgram from environment variables

  /**
   * Creates a live WebSocket connection to Deepgram's real-time transcription API
   * @param onTranscript callback function to handle transcripts returned by Deepgram
   * @param sampleRate audio sample rate (default = 16000 Hz)
   * @returns WebSocket connection to Deepgram
   */
  async createLive(
    onTranscript: (transcript: string) => void, // 👂 callback that receives final transcript strings
    sampleRate = 16000
  ): Promise<WebSocket> {
    if (!this.apiKey) {
      throw new Error('DEEPGRAM_API_KEY is not defined'); // ❌ fail fast if API key missing
    }

    // 🌐 Build Deepgram WebSocket URL with encoding + audio params
    const url = `wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=${sampleRate}&channels=1&interim_results=true`;
    this.logger.log(`Connecting to Deepgram with sample_rate=${sampleRate}`);

    // 📡 Open WebSocket connection with authorization header
    const ws = new WebSocket(url, {
      headers: {
        Authorization: `Token ${this.apiKey}`,
      },
    });

    // ✅ Connected successfully
    ws.on('open', () => {
      this.logger.log('Deepgram connection opened');
    });

    // 📩 Handle messages from Deepgram (transcription results, interim + final)
    ws.on('message', (data: WebSocket.Data) => {
      try {
        const str = data.toString();
        const obj = JSON.parse(str); // parse JSON response

        this.logger.debug(
          'Deepgram message received: ' + JSON.stringify(obj).slice(0, 200)
        );

        // If it's a final transcript, extract text and send to callback
        if (
          obj.is_final && 
          obj.channel?.alternatives &&
          obj.channel.alternatives[0].transcript
        ) {
          const transcript = obj.channel.alternatives[0].transcript;
          onTranscript(transcript); // 🔊 send transcript to user callback
        }
      } catch (err) {
        this.logger.error('Deepgram message parse error', err as any);
      }
    });



    // ⚠️ Handle WebSocket errors
    ws.on('error', (err) => {
      this.logger.error('Deepgram socket error', err as any);
    });

    // 🔒 Handle socket close
    ws.on('close', (code, reason) => {
      this.logger.log(
        `Deepgram socket closed: ${code} – ${reason?.toString() ?? ''}`
      );
    });

    return ws; // ↩️ return live Deepgram WebSocket connection
  }
}
