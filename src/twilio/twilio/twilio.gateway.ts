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
import { LatencyTracker } from 'src/utils/latency.util';
import { ElevenLabsService } from 'src/elevenlabs/elevenlabs.service';

// Initialize Twilio REST client (for optional usage, e.g. call control)
const client = twilio(process.env.TWILIO_SID!, process.env.TWILIO_AUTH_TOKEN!);

// Active call structure (per ongoing call stream)
interface ActiveCall {
  client: WebSocket;       // Twilio WebSocket connection
  callSid: string;         // Unique Twilio call identifier
  streamSid: string;       // Unique Twilio media stream identifier
  dg?: WebSocket;          // Deepgram live transcription WebSocket
  dgOpen: boolean;         // Whether Deepgram is connected
  buf: Buffer[];           // Buffer for holding audio before DG connection
  maxBuf: number;          // Max buffer size
  transcriptHistory: any[];// Keeps all transcripts (with timestamps/finality)
  wavWriter?: WavWriter;   // Writes audio to WAV file
}

// WebSocket gateway that Twilio Media Streams connect to
@WebSocketGateway({ path: '/call', cors: true })
export class TwilioWebSocketGateway {
  @WebSocketServer() server: Server; // Underlying WS server
  private logger = new Logger(TwilioWebSocketGateway.name);
  private calls = new Map<string, ActiveCall>(); // Map of streamSid → ActiveCall
  private wavWriters = new Map<string, WavWriter>(); // Map of streamSid → WavWriter

  constructor(
    private readonly deepgram: DeepgramService,  // Transcription service
    private readonly audioService: AudioService, // Text-to-Speech service
    private readonly llmService: LlmService,     // LLM for generating bot replie
  ) { }

  /**
   * Called when a new WebSocket connection is opened by Twilio.
   * Input: Twilio WebSocket client
   * Output: None (sets up event listeners)
   */
  handleConnection(client: WebSocket) {
    this.logger.log('Twilio WebSocket connected');
    client.on('message', (data) => this.onMessage(client, data));
    client.on('close', () => this.logger.log('Twilio WebSocket disconnected'));
  }

  /**
   * Handle incoming WS messages from Twilio.
   * Input: JSON message { event: 'start' | 'media' | 'stop', ... }
   * Output: Routes event to appropriate handler
   */
  private async onMessage(client: WebSocket, raw: any) {
    try {
      const msg = JSON.parse(raw.toString());
      if (!msg?.event) return;

      switch (msg.event) {
        case 'connected': // Twilio confirms stream connection
          this.logger.log(`New media stream connected: ${JSON.stringify(msg)}`);
          break;
        case 'start': // Stream started → set up call + Deepgram
          await this.onStart(client, msg.start);
          break;
        case 'media': // Incoming audio chunk (μ-law base64)
          await this.onMedia(msg);
          break;
        case 'stop': // Call ended
          this.onStop(msg.stop);
          break;
        default:
          this.logger.debug(`Unhandled Twilio event: ${msg.event}`);
      }
    } catch (e: any) {
      this.logger.error(`Error parsing Twilio WS message: ${e?.message}`);
    }
  }

  /**
   * Handle "start" event from Twilio.
   * Input: start info { streamSid, callSid }
   * Output: Creates WAV writer, connects to Deepgram, registers ActiveCall
   */
  private async onStart(client: WebSocket, start: any) {
    const { streamSid, callSid } = start;
    this.logger.log(`Media stream started: ${streamSid} (callSid: ${callSid})`);

    // Create WAV writer for recording caller audio
    const wavWriter = new WavWriter(`recordings/call_${callSid}.wav`);
    this.wavWriters.set(streamSid, wavWriter);

    // Register call state
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

    // Connect to Deepgram for transcription
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



  /**
   * Handle "media" event (audio packet from Twilio).
   * Input: msg { streamSid, media: { payload (base64 ulaw) } }
   * Output: Writes audio to WAV, forwards to Deepgram
   */
  private async onMedia(msg: any) {
    const { streamSid, media } = msg;
    const call = this.calls.get(streamSid);
    if (!call) return;
    if (!media?.payload) return;

    try {
      const ulaw = Buffer.from(media.payload, 'base64');

      // Save to WAV file
      const writer = this.wavWriters.get(streamSid);
      if (writer) writer.writeMulaw(ulaw);

      // Send audio to Deepgram (or buffer if not ready yet)
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

  /**
   * Handle "stop" event (call ended).
   * Input: stop info { streamSid, callSid }
   * Output: Close Deepgram, finalize WAV file, cleanup
   */
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

  /**
   * Handle transcript event from Deepgram.
   * Input: transcript object (final or interim)
   * Output: If final → run LLM + TTS, send bot reply back to caller
   */
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

      // Track full pipeline latency
      const pipelineTracker = new LatencyTracker("Full Pipeline");

      // 1. LLM → generate bot reply
      const reply = await LatencyTracker.track("Groq LLM", () =>
        this.llmService.generateResponse([
          {
            role: 'system',
            content: `You are a polite hotel assistant for Axion Hotel in Lake City.  
- Help with room booking, availability, check-in/out, and services.  
- Reply naturally, like a receptionist.  
- Keep answers short, clear, and to the point.`
          },
          { role: 'user', content: text },
        ])
      );

      this.logger.log(`🤖 Bot: ${reply}`);

      try {
        // 2. TTS → convert reply text to speech
        const audioPayloadBase64Mulaw = await LatencyTracker.track("Deepgram TTS", () =>
          this.audioService.textToAudio(reply)
        );

        // Save bot reply audio for debugging
        const filename = `bot_reply_${Date.now()}.mulaw`;
        await this.audioService.saveAudioToFile(audioPayloadBase64Mulaw, filename);

        // Write bot reply to same WAV recording
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

        // 3. Send audio reply back to Twilio for playback to caller
        this.sendAudioToTwilio(streamSid, audioPayloadBase64Mulaw);
      } catch (e: any) {
        this.logger.error(`TTS failed: ${e.message}`);
      }

      // End latency tracking
      pipelineTracker.end();
    } else {
      // Interim transcript (not final yet)
      this.logger.debug(`[interim] ${text}`);
    }
  }

  /**
   * Send bot audio back to Twilio WebSocket.
   * Input: streamSid (call stream ID), audio base64 μ-law
   * Output: Sends 'media' event (bot audio) + 'mark' event (playback complete)
   */
  private sendAudioToTwilio(
    streamSid: string,
    audioPayloadBase64Mulaw: string,
  ) {
    const call = this.calls.get(streamSid);
    if (!call || !call.client) return;

    // Bot audio to Twilio
    const mediaMessage = {
      event: 'media',
      streamSid,
      media: { payload: audioPayloadBase64Mulaw },
    };
    call.client.send(JSON.stringify(mediaMessage));

    // Marker event → lets Twilio know bot playback ended
    const markMessage = {
      event: 'mark',
      streamSid,
      mark: { name: 'playback-completed' },
    };
    call.client.send(JSON.stringify(markMessage));
  }
}
