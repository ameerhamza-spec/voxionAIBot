// twilio.gateway.ts
import {
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, WebSocket } from 'ws';
import { WavWriter } from 'src/utils/wav-writer';
import twilio from 'twilio';
import { LlmService } from 'src/llm/llm.service';
import { DeepgramService } from 'src/deepgram/deepgram.service';
import { AudioService } from 'src/audio/audio.service';


const client = twilio(process.env.TWILIO_SID!, process.env.TWILIO_AUTH_TOKEN!);

interface ActiveCall {
  client: WebSocket;
  callSid: string;
  streamSid: string;
  dg?: WebSocket;
  dgOpen: boolean;
  buf: Buffer[];
  maxBuf: number;
  transcriptHistory: any[];
  wavWriter?: WavWriter;
}

@WebSocketGateway({ path: '/call', cors: true })
export class TwilioWebSocketGateway {
  @WebSocketServer() server: Server;
  private logger = new Logger(TwilioWebSocketGateway.name);
  private calls = new Map<string, ActiveCall>();
  private wavWriters = new Map<string, WavWriter>();

  constructor(
    private readonly deepgram: DeepgramService,
    private readonly audioService: AudioService,
    private readonly llmService: LlmService, // ✅ inject LLM
  ) { }

  handleConnection(client: WebSocket) {
    this.logger.log('Twilio WebSocket connected');
    client.on('message', (data) => this.onMessage(client, data));
    client.on('close', () => this.logger.log('Twilio WebSocket disconnected'));
  }

  private async onMessage(client: WebSocket, raw: any) {
    try {
      const msg = JSON.parse(raw.toString());
      if (!msg?.event) return;

      switch (msg.event) {
        case 'connected':
          this.logger.log(`New media stream connected: ${JSON.stringify(msg)}`);
          break;
        case 'start':
          await this.onStart(client, msg.start);
          break;
        case 'media':
          await this.onMedia(msg);
          break;
        case 'stop':
          this.onStop(msg.stop);
          break;
        default:
          this.logger.debug(`Unhandled Twilio event: ${msg.event}`);
      }
    } catch (e: any) {
      this.logger.error(`Error parsing Twilio WS message: ${e?.message}`);
    }
  }

  private async onStart(client: WebSocket, start: any) {
    const { streamSid, callSid } = start;
    this.logger.log(`Media stream started: ${streamSid} (callSid: ${callSid})`);

    // Create WAV writer for recording caller
    const wavWriter = new WavWriter(`recordings/call_${callSid}.wav`);
    this.wavWriters.set(streamSid, wavWriter);

    const call: ActiveCall = {
      client,
      callSid,
      streamSid,
      dgOpen: false,
      buf: [],
      maxBuf: 400,
      transcriptHistory: [],
      wavWriter,
    };
    this.calls.set(streamSid, call);

    try {
      const dg = await this.deepgram.createLive((tr) =>
        this.onTranscript(streamSid, tr),
      );
      call.dg = dg;
      call.dgOpen = true;
      this.logger.log(`Deepgram connected for stream ${streamSid}`);
    } catch (e: any) {
      this.logger.error(`Deepgram live connect failed: ${e?.message}`);
    }
  }

  private async onMedia(msg: any) {
    const { streamSid, media } = msg;
    const call = this.calls.get(streamSid);
    if (!call) return;
    if (!media?.payload) return;

    try {
      const ulaw = Buffer.from(media.payload, 'base64');

      // Save to WAV file (caller side)
      const writer = this.wavWriters.get(streamSid);
      if (writer) writer.writeMulaw(ulaw);

      // Send to Deepgram
      if (call.dg && call.dgOpen) {
        call.dg.send(ulaw);
      } else {
        call.buf.push(ulaw);
        if (call.buf.length > call.maxBuf) call.buf.shift();
      }
    } catch (e: any) {
      this.logger.error(`onMedia error (${streamSid}): ${e?.message}`);
    }
  }

  private onStop(stop: any) {
    const { streamSid, callSid } = stop;
    this.logger.log(`Call ended: ${callSid} (streamSid: ${streamSid})`);
    const call = this.calls.get(streamSid);
    if (call?.dg) call.dg.close();
    this.calls.delete(streamSid);

    const writer = this.wavWriters.get(streamSid);
    if (writer) {
      writer.end();
      this.wavWriters.delete(streamSid);
    }
  }


  private async onTranscript(streamSid: string, d: any) {
    const call = this.calls.get(streamSid);
    if (!call) return;

    const text =
      d?.channel?.alternatives?.[0]?.transcript || d?.transcript || '';
    const isFinal = !!d?.is_final;
    if (!text?.trim()) return;

    const entry = { text, isFinal, ts: new Date().toISOString() };
    call.transcriptHistory.push(entry);

    if (isFinal) {
      this.logger.log(`🗣 Caller (${streamSid}): ${text}`);

      // ✅ Call LLM with short response constraint
      const reply = await this.llmService.generateResponse([
        {
          role: 'system',
          content: `You are a friendly and professional hotel booking assistant for **Axion Hotel**. 
- Location: Lake City.  
- Your job: help guests book rooms, answer questions about availability, check-in/check-out times, and services.  
- Speak in a natural, conversational tone (like a real human receptionist).  
- Always guide the user politely and keep responses short and clear.`
        },
        { role: 'user', content: text },
      ]);


      this.logger.log(`🤖 Bot: ${reply}`);

      try {
        const audioPayloadBase64Mulaw = await this.audioService.textToAudio(reply);

        const filename = `bot_reply_${Date.now()}.mulaw`;
        await this.audioService.saveAudioToFile(audioPayloadBase64Mulaw, filename);

        const writer = this.wavWriters.get(streamSid);
        if (writer) {
          try {
            const botMulawBuffer = Buffer.from(audioPayloadBase64Mulaw, 'base64');
            writer.writeMulaw(botMulawBuffer);
          } catch (err: any) {
            this.logger.error(
              `Failed to write bot audio into wav for ${streamSid}: ${err?.message}`,
            );
          }
        }

        this.sendAudioToTwilio(streamSid, audioPayloadBase64Mulaw);
      } catch (e: any) {
        this.logger.error(`TTS failed: ${e.message}`);
      }
    } else {
      this.logger.debug(`[interim] ${text}`);
    }
  }




  private sendAudioToTwilio(
    streamSid: string,
    audioPayloadBase64Mulaw: string,
  ) {
    const call = this.calls.get(streamSid);
    if (!call || !call.client) return;

    const mediaMessage = {
      event: 'media',
      streamSid,
      media: { payload: audioPayloadBase64Mulaw },
    };
    call.client.send(JSON.stringify(mediaMessage));

    const markMessage = {
      event: 'mark',
      streamSid,
      mark: { name: 'playback-completed' },
    };
    call.client.send(JSON.stringify(markMessage));
  }

}