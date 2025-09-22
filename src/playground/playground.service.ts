import { Injectable, Logger } from '@nestjs/common';
import WebSocket from 'ws';
import { LlmService } from '../llm/llm.service';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { PlaygroundDeepgramService } from './playground-deepgram/playground-deepgram.service';

// A session represents one connected WS client + resources (Deepgram + ffmpeg if needed)
interface PlaygroundSession {
  client: WebSocket;  // browser/client connection
  dgSocket: WebSocket; // Deepgram live transcription socket
  directStream: boolean; // true if audio can go directly, false if needs conversion
  ffmpeg?: ChildProcessWithoutNullStreams; // ffmpeg process for resampling
  silenceInterval?: NodeJS.Timeout; // 🆕 keepalive silence timer
}

@Injectable()
export class PlaygroundService {
  private readonly logger = new Logger(PlaygroundService.name);
  private sessions = new Map<WebSocket, PlaygroundSession>(); // track all sessions

  constructor(
    private readonly deepgramService: PlaygroundDeepgramService,
    private readonly llm: LlmService,
  ) {}

  /**
   * Starts a new playground session for a client.
   */
  async startSession(client: WebSocket, sampleRate = 48000) {
    this.logger.log('Starting new playground session');
    try {
      // Create Deepgram WS connection
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

      // 🆕 Start silence keepalive
      const silenceInterval = this.startSilence(dgSocket);

      // Save session
      this.sessions.set(client, {
        client,
        dgSocket,
        directStream: direct,
        ffmpeg,
        silenceInterval,
      });

      // Notify client
      client.send(JSON.stringify({ type: 'registered' }));
      this.logger.log('Playground session registered and client notified');
    } catch (err: any) {
      this.logger.error('Failed to start session:', err.message ?? err);
      try {
        client.send(
          JSON.stringify({ type: 'error', message: 'Start session failed' }),
        );
      } catch {}
    }
  }

  /**
   * Handle incoming audio from client.
   */
  async handleAudio(client: WebSocket, data: Buffer) {
    const session = this.sessions.get(client);
    if (!session) {
      this.logger.warn(
        'No session found, creating a temporary session (direct 48k)',
      );
      await this.startSession(client, 48000);
    }
    const sess = this.sessions.get(client);
    if (!sess) return;

    if (sess.directStream) {
      // Send raw audio directly to Deepgram
      if (sess.dgSocket.readyState === WebSocket.OPEN) {
        sess.dgSocket.send(data);
        this.logger.debug(`➡️ Sent ${data.length} bytes DIRECT to Deepgram`);
      } else {
        this.logger.warn('Deepgram socket not open, dropping chunk');
      }
    } else {
      // Resample via ffmpeg first
      if (!sess.ffmpeg) {
        sess.ffmpeg = this.createFfmpegProcess(sess.dgSocket);
      }
      if (sess.ffmpeg.stdin && sess.ffmpeg.stdin.writable) {
        sess.ffmpeg.stdin.write(data);
        this.logger.debug(`🎤 Wrote ${data.length} bytes to ffmpeg stdin`);
      } else {
        this.logger.warn('ffmpeg stdin not writable');
      }
    }
  }

  /**
   * Creates an ffmpeg process to downsample audio before sending to Deepgram.
   */
  private createFfmpegProcess(
    dgSocket: WebSocket,
  ): ChildProcessWithoutNullStreams {
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      's16le', // input format: PCM 16-bit little endian
      '-ar',
      '48000', // input sample rate
      '-ac',
      '1', // mono
      '-i',
      'pipe:0', // input from stdin
      '-f',
      's16le', // output format
      '-ar',
      '16000', // resample to 16k
      '-ac',
      '1', // mono
      'pipe:1', // output to stdout
    ];
    this.logger.debug(`Spawning ffmpeg with args: ${args.join(' ')}`);
    const ffmpeg = spawn('ffmpeg', args);

    // Forward converted audio to Deepgram
    ffmpeg.stdout.on('data', (chunk: Buffer) => {
      if (dgSocket.readyState === WebSocket.OPEN) {
        dgSocket.send(chunk);
        this.logger.debug(
          `➡️ Sent ${chunk.length} bytes PCM to Deepgram via ffmpeg`,
        );
      }
    });

    ffmpeg.stderr.on('data', (e: Buffer) => {
      this.logger.error(`ffmpeg stderr: ${e.toString()}`);
    });

    ffmpeg.on('exit', (code, sig) => {
      this.logger.log(`ffmpeg exited with code=${code}, sig=${sig}`);
    });

    return ffmpeg;
  }

  /**
   * 🔊 Inject silence every 5s to keep Deepgram alive.
   */
  private startSilence(dgSocket: WebSocket): NodeJS.Timeout {
    return setInterval(() => {
      if (dgSocket.readyState === WebSocket.OPEN) {
        const silence = Buffer.alloc(8192); // 8 KB of zeroes
        dgSocket.send(silence);
        this.logger.debug('➡️ Sent silence frame to Deepgram (keepalive)');
      }
    }, 5000);
  }

  /**
   * Handles transcript messages from Deepgram.
   */
  private handleDeepgramTranscript(client: WebSocket, transcript: string) {
    this.logger.log(`Deepgram transcript: "${transcript}"`);
    const session = this.sessions.get(client);
    if (!session) {
      this.logger.warn('Transcript arrived but session missing');
      return;
    }

    // Send transcript back to client
    try {
      session.client.send(
        JSON.stringify({ type: 'transcript', text: transcript }),
      );
      this.logger.log('Transcript forwarded to client');
    } catch (err) {
      this.logger.error('Error forwarding transcript to client', err as any);
    }

    // Ask LLM for a response
    (async () => {
      try {
        const botReply = await this.llm.generateResponse([
          {
            role: 'system',
            content: `You are a friendly and professional hotel booking assistant for **Axion Hotel**.
- Location: Lake City.
- Help users book rooms, answer about availability, check-in/out, services.
- Speak in natural, polite, short, clear sentences like a receptionist.`,
          },
          { role: 'user', content: transcript },
        ]);
        session.client.send(
          JSON.stringify({ type: 'bot_text', text: botReply }),
        );
        this.logger.log('bot_text sent to client');
      } catch (e) {
        this.logger.error('LLM generateResponse error', e as any);
        try {
          session.client.send(
            JSON.stringify({ type: 'error', message: 'LLM error' }),
          );
        } catch {}
      }
    })();
  }

  /**
   * Ends a session and cleans up resources.
   */
  endSession(client: WebSocket) {
    const session = this.sessions.get(client);
    if (session) {
      this.logger.log('Ending session for client');
      try {
        session.ffmpeg?.stdin.end();
      } catch {}
      try {
        session.ffmpeg?.kill('SIGKILL');
      } catch {}
      try {
        session.dgSocket.close();
      } catch {}
      // 🆕 stop silence timer
      if (session.silenceInterval) clearInterval(session.silenceInterval);

      this.sessions.delete(client);
    }
  }
}
