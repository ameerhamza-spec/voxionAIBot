import { Injectable, Logger } from '@nestjs/common';
import WebSocket from 'ws';
import { LlmService } from '../llm/llm.service';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { PlaygroundDeepgramService } from './playground-deepgram/playground-deepgram.service';
import { AudioService } from 'src/audio/audio.service';
import { PlaygroundWavWriter } from 'src/utils/wav-writer-playground';
import { mulawToPCM16 } from 'src/utils/audio-utils';
import { LatencyTracker } from 'src/utils/latency.util';


// A session represents one connected WS client + resources
interface PlaygroundSession {
  client: WebSocket;
  dgSocket: WebSocket;
  directStream: boolean;
  ffmpeg?: ChildProcessWithoutNullStreams;
  silenceInterval?: NodeJS.Timeout;
  wavWriter?: PlaygroundWavWriter;
}

@Injectable()
export class PlaygroundService {
  private readonly logger = new Logger(PlaygroundService.name);
  private sessions = new Map<WebSocket, PlaygroundSession>();

  constructor(
    private readonly deepgramService: PlaygroundDeepgramService,
    private readonly llm: LlmService,
    private readonly audioService: AudioService,
  ) { }

  async startSession(client: WebSocket, sampleRate = 48000) {
    const tracker = new LatencyTracker('Playground.startSession');
    this.logger.log('Starting new playground session');
    try {
      const dgSocket = await this.deepgramService.createLive(
        (msg) => this.handleDeepgramTranscript(client, msg),
        sampleRate,
      );

      const direct = sampleRate === 48000;
      let ffmpeg: ChildProcessWithoutNullStreams | undefined = undefined;
      if (!direct) {
        ffmpeg = this.createFfmpegProcess(dgSocket);
        this.logger.log('FFmpeg process spawned for sample rate conversion');
      }

      const silenceInterval = this.startSilence(dgSocket);

      const filename = `recordings/playground_${Date.now()}.wav`;
      const wavWriter = new PlaygroundWavWriter(filename);

      this.sessions.set(client, {
        client,
        dgSocket,
        directStream: direct,
        ffmpeg,
        silenceInterval,
        wavWriter,
      });

      client.send(JSON.stringify({ type: 'registered' }));
      this.logger.log('Playground session registered and client notified');
    } catch (err: any) {
      this.logger.error('Failed to start session:', err.message ?? err);
      try {
        client.send(
          JSON.stringify({ type: 'error', message: 'Start session failed' }),
        );
      } catch { }
    } finally {
      tracker.end();
    }
  }

  async handleAudio(client: WebSocket, data: Buffer) {
    const tracker = new LatencyTracker('Playground.handleAudio');
    const session = this.sessions.get(client);
    if (!session) {
      this.logger.warn('No session found, creating temporary (48k direct)');
      await this.startSession(client, 48000);
    }
    const sess = this.sessions.get(client);
    if (!sess) return;

    if (sess.wavWriter) {
      try {
        sess.wavWriter.writePCM16(data);
      } catch (err) {
        this.logger.error('Failed to write user audio to wav', err as any);
      }
    }

    if (sess.directStream) {
      if (sess.dgSocket.readyState === WebSocket.OPEN) {
        sess.dgSocket.send(data);
        this.logger.debug(`➡️ Sent ${data.length} bytes DIRECT to Deepgram`);
      }
    } else {
      if (!sess.ffmpeg) {
        sess.ffmpeg = this.createFfmpegProcess(sess.dgSocket);
      }
      if (sess.ffmpeg.stdin?.writable) {
        sess.ffmpeg.stdin.write(data);
      }
    }

    tracker.end();
  }

  private createFfmpegProcess(
    dgSocket: WebSocket,
  ): ChildProcessWithoutNullStreams {
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      's16le',
      '-ar',
      '48000',
      '-ac',
      '1',
      '-i',
      'pipe:0',
      '-f',
      's16le',
      '-ar',
      '16000',
      '-ac',
      '1',
      'pipe:1',
    ];
    this.logger.debug(`Spawning ffmpeg: ${args.join(' ')}`);
    const ffmpeg = spawn('ffmpeg', args);

    ffmpeg.stdout.on('data', (chunk: Buffer) => {
      if (dgSocket.readyState === WebSocket.OPEN) {
        dgSocket.send(chunk);
      }
    });

    ffmpeg.stderr.on('data', (e: Buffer) => {
      this.logger.error(`ffmpeg stderr: ${e.toString()}`);
    });

    ffmpeg.on('exit', (code, sig) => {
      this.logger.log(`ffmpeg exited code=${code}, sig=${sig}`);
    });

    return ffmpeg;
  }

  private startSilence(dgSocket: WebSocket): NodeJS.Timeout {
    return setInterval(() => {
      if (dgSocket.readyState === WebSocket.OPEN) {
        const silence = Buffer.alloc(8192);
        dgSocket.send(silence);
      }
    }, 5000);
  }

  private handleDeepgramTranscript(client: WebSocket, transcript: string) {
    this.logger.log(`Deepgram transcript: "${transcript}"`);
    const session = this.sessions.get(client);
    if (!session) return;

    try {
      session.client.send(
        JSON.stringify({ type: 'transcript', text: transcript }),
      );
    } catch { }

    (async () => {
      try {
        // 1️⃣ LLM Response Latency
        const botReply = await LatencyTracker.track(
  'LLM.generateResponse',
  () =>
    this.llm.generateResponse([
      {
        role: 'system',
        content: `You are a professional hotel booking assistant for Axion Hotel in Lake City.
Help users with bookings, availability, check-in/out, and services.
Keep replies polite, short, and receptionist-style.`,
      },
      { role: 'user', content: transcript.trim() }, // 🧹 clean transcript
    ]),
);

        session.client.send(
          JSON.stringify({ type: 'bot_text', text: botReply }),
        );

        // 2️⃣ TTS Latency
        const base64Audio = await LatencyTracker.track(
          'TTS.textToAudio',
          () => this.audioService.textToAudio(botReply),
        );

        const filename = `playground_reply_${Date.now()}.mulaw`;
        await this.audioService.saveAudioToFile(base64Audio, filename);

        // 3️⃣ Audio Convert + Write Latency
        if (session.wavWriter) {
          await LatencyTracker.track('BotAudio.writePCM16', async () => {
            const botBufMulaw = Buffer.from(base64Audio, 'base64');
            const botBufPcm16 = await mulawToPCM16(botBufMulaw);
            session.wavWriter!.writePCM16(botBufPcm16);
          });
        }



        // 4️⃣ Send to client
        const sendTracker = new LatencyTracker('Send bot_audio → Client');
        session.client.send(
          JSON.stringify({ type: 'bot_audio', audio: base64Audio }),
        );
        sendTracker.end();
      } catch (e) {
        this.logger.error('LLM/TTS error', e as any);
      }
    })();
  }

  endSession(client: WebSocket) {
    const tracker = new LatencyTracker('Playground.endSession');
    const session = this.sessions.get(client);
    if (session) {
      try {
        session.ffmpeg?.stdin.end();
      } catch { }
      try {
        session.ffmpeg?.kill('SIGKILL');
      } catch { }
      try {
        session.dgSocket.close();
      } catch { }
      if (session.silenceInterval) clearInterval(session.silenceInterval);
      if (session.wavWriter) session.wavWriter.end();
      this.sessions.delete(client);
    }
    tracker.end();
  }
}
