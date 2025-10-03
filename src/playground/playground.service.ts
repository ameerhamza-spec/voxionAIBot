// src/playground/playground.service.ts

import { Injectable, Logger } from '@nestjs/common';
import WebSocket from 'ws';
import { LlmService } from '../llm/llm.service';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { PlaygroundDeepgramService } from './playground-deepgram/playground-deepgram.service';
import { AudioService } from 'src/audio/audio.service';
import { PlaygroundWavWriter } from 'src/utils/wav-writer-playground';
import { mulawToPCM16 } from 'src/utils/audio-utils';
import { LatencyTracker } from 'src/utils/latency.util';

interface PlaygroundSession {
  client: WebSocket;
  dgSocket: WebSocket;
  directStream: boolean;
  ffmpeg?: ChildProcessWithoutNullStreams;
  silenceInterval?: NodeJS.Timeout;
  wavWriter?: PlaygroundWavWriter;
  hasGreeted?: boolean;
  isProcessing: boolean; // Prevent overlapping processing
  audioChunks: string[]; // Store audio chunks for recording
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
        hasGreeted: false,
        isProcessing: false,
        audioChunks: [],
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

    // Write user audio to WAV
    if (sess.wavWriter) {
      try {
        sess.wavWriter.writePCM16(data);
      } catch (err) {
        this.logger.error('Failed to write user audio to wav', err as any);
      }
    }

    // Send to Deepgram
    if (sess.directStream) {
      if (sess.dgSocket.readyState === WebSocket.OPEN) {
        sess.dgSocket.send(data);
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

  async handleUserText(client: WebSocket, text: string) {
    const session = this.sessions.get(client);
    if (!session) {
      this.logger.warn('No active session for typed text');
      return;
    }

    session.client.send(JSON.stringify({ type: 'transcript', text }));

    try {
      const botReply = await this.llm.generateResponse([
        {
          role: 'system',
          content: `You are a professional hotel booking assistant for Axion Hotel in Lake City.
Help users with bookings, availability, check-in/out, and services.
Keep replies polite, short, and receptionist-style.`,
        },
        { role: 'user', content: text.trim() },
      ]);

      session.client.send(JSON.stringify({ type: 'bot_text', text: botReply }));

      // Use streaming TTS for text input as well
      await this.streamBotResponse(session, botReply);
    } catch (e) {
      this.logger.error('Error handling user text', e as any);
    }
  }

  private async handleDeepgramTranscript(client: WebSocket, transcript: string) {
    this.logger.log(`Deepgram transcript: "${transcript}"`);
    const session = this.sessions.get(client);
    if (!session) return;

    // Prevent overlapping processing
    if (session.isProcessing) {
      this.logger.log('Already processing previous request, skipping...');
      return;
    }

    session.isProcessing = true;

    try {
      session.client.send(
        JSON.stringify({ type: 'transcript', text: transcript }),
      );

      const botReplyRaw = await this.llm.generateResponse([
        {
          role: 'system',
          content: `You are a professional hotel booking assistant.
Focus only on answering the user's booking or service questions politely and concisely.
Keep responses under 2 sentences for faster interaction.`,
        },
        { role: 'user', content: transcript.trim() },
      ]);

      let botReply = botReplyRaw;

      // ✅ Only allow greeting once
      if (!session.hasGreeted) {
        session.hasGreeted = true;
      } else {
        // Strip repeated greetings
        botReply = botReply.replace(/welcome to axion hotel.*?(\.|!)/gi, '');
        botReply = botReply.replace(/hello[!.,]?\s*/i, '');
        botReply = botReply.replace(/good (morning|afternoon|evening).*?(\.|!)/gi, '');
      }

      botReply = botReply.trim();
      if (!botReply) {
        botReply = "Sure, could you please provide more details?";
      }

      // Send bot text immediately
      session.client.send(
        JSON.stringify({ type: 'bot_text', text: botReply }),
      );

      // Use streaming TTS for bot response
      await this.streamBotResponse(session, botReply);

    } catch (e) {
      this.logger.error('LLM/TTS error', e as any);
      session.isProcessing = false;
    }
  }

  /**
   * Stream bot response using TTS with low latency
   */
  private async streamBotResponse(session: PlaygroundSession, botReply: string) {
    const tracker = new LatencyTracker('Playground.streamBotResponse');

    try {
      // Clear previous audio chunks
      session.audioChunks = [];

      // Use fast streaming TTS
      await this.audioService.streamTextToAudioFast(
        botReply,
        (audioChunk: string, isFinal: boolean) => {
          if (audioChunk && !isFinal) {
            // Send audio chunk immediately to client
            session.client.send(
              JSON.stringify({
                type: 'bot_audio_chunk',
                audio: audioChunk,
                final: false
              }),
            );

            // Store chunk for recording
            session.audioChunks.push(audioChunk);
          }

          if (isFinal) {
            // Send final marker
            session.client.send(
              JSON.stringify({
                type: 'bot_audio_chunk',
                final: true
              }),
            );

            // Save complete audio to file in background
            this.saveBotAudioToFile(session, botReply).catch(e =>
              this.logger.error('Failed to save bot audio:', e)
            );

            session.isProcessing = false;
            tracker.end();
          }
        }
      );
    } catch (error) {
      this.logger.error('Streaming bot response failed:', error);
      session.isProcessing = false;
      tracker.end();

      // Fallback to standard TTS
      try {
        const fallbackAudio = await this.audioService.textToAudio(botReply);
        session.client.send(
          JSON.stringify({ type: 'bot_audio', audio: fallbackAudio }),
        );

        // Save fallback audio
        await this.saveBotAudioToFile(session, botReply, fallbackAudio);
      } catch (fallbackError) {
        this.logger.error('Fallback TTS also failed:', fallbackError);
      }
    }
  }

  /**
   * Save bot audio to file (background task)
   */
  private async saveBotAudioToFile(session: PlaygroundSession, botReply: string, preGeneratedAudio?: string) {
    try {
      let base64Audio: string;

      if (preGeneratedAudio) {
        base64Audio = preGeneratedAudio;
      } else {
        // Combine all chunks
        base64Audio = session.audioChunks.join('');
      }

      const filename = `playground_reply_${Date.now()}.mulaw`;
      await this.audioService.saveAudioToFile(base64Audio, filename);

      // Write to WAV file if writer exists
      if (session.wavWriter && base64Audio) {
        await LatencyTracker.track('BotAudio.writePCM16', async () => {
          const botBufMulaw = Buffer.from(base64Audio, 'base64');
          const botBufPcm16 = await mulawToPCM16(botBufMulaw);
          session.wavWriter!.writePCM16(botBufPcm16);
        });
      }
    } catch (e) {
      this.logger.error('Audio save/write error', e as any);
    }
  }

  private createFfmpegProcess(dgSocket: WebSocket): ChildProcessWithoutNullStreams {
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

  /**
   * Get session statistics for monitoring
   */
  getSessionStats() {
    return {
      activeSessions: this.sessions.size,
      sessions: Array.from(this.sessions.values()).map(session => ({
        hasGreeted: session.hasGreeted,
        isProcessing: session.isProcessing,
        audioChunksCount: session.audioChunks.length,
      })),
    };
  }
}