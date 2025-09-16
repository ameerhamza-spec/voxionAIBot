import { Injectable, Logger } from '@nestjs/common';
import WebSocket from 'ws';
// import { PlaygroundDeepgramService } from './playground-deepgram.service';
import { LlmService } from '../llm/llm.service';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { PlaygroundDeepgramService } from './playground-deepgram/playground-deepgram.service';

interface PlaygroundSession {
    client: WebSocket;
    dgSocket: WebSocket;
    directStream: boolean;
    ffmpeg?: ChildProcessWithoutNullStreams;
}

@Injectable()
export class PlaygroundService {
    private readonly logger = new Logger(PlaygroundService.name);
    private sessions = new Map<WebSocket, PlaygroundSession>();

    constructor(
        private readonly deepgramService: PlaygroundDeepgramService,
        private readonly llm: LlmService,
    ) { }

    async startSession(client: WebSocket, sampleRate = 48000) {
        this.logger.log('Starting new playground session');
        try {
            const dgSocket = await this.deepgramService.createLive(
                (msg) => this.handleDeepgramTranscript(client, msg),
                sampleRate
            );
            const direct = sampleRate === 48000;
            this.logger.log(`Deepgram live socket created; directStream = ${direct}`);

            let ffmpeg: ChildProcessWithoutNullStreams | undefined = undefined;
            if (!direct) {
                ffmpeg = this.createFfmpegProcess(dgSocket);
                this.logger.log('FFmpeg process spawned for sample rate conversion');
            }

            this.sessions.set(client, { client, dgSocket, directStream: direct, ffmpeg });

            client.send(JSON.stringify({ type: 'registered' }));
            this.logger.log('Playground session registered and client notified');
        } catch (err: any) {
            this.logger.error('Failed to start session:', err.message ?? err);
            try { client.send(JSON.stringify({ type: 'error', message: 'Start session failed' })); } catch (_) { }
        }
    }

    async handleAudio(client: WebSocket, data: Buffer) {
        const session = this.sessions.get(client);
        if (!session) {
            this.logger.warn('No session found, creating a temporary session (direct 48k)');
            await this.startSession(client, 48000);
        }
        const sess = this.sessions.get(client);
        if (!sess) return;

        if (sess.directStream) {
            if (sess.dgSocket.readyState === WebSocket.OPEN) {
                sess.dgSocket.send(data);
                this.logger.debug(`➡️ Sent ${data.length} bytes DIRECT to Deepgram`);
            } else {
                this.logger.warn('Deepgram socket not open, dropping chunk');
            }
        } else {
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

    private createFfmpegProcess(dgSocket: WebSocket): ChildProcessWithoutNullStreams {
        const args = [
            '-hide_banner', '-loglevel', 'error',
            '-f', 's16le',
            '-ar', '48000',
            '-ac', '1',
            '-i', 'pipe:0',
            '-f', 's16le',
            '-ar', '16000',
            '-ac', '1',
            'pipe:1'
        ];
        this.logger.debug(`Spawning ffmpeg with args: ${args.join(' ')}`);
        const ffmpeg = spawn('ffmpeg', args);

        ffmpeg.stdout.on('data', (chunk: Buffer) => {
            if (dgSocket.readyState === WebSocket.OPEN) {
                dgSocket.send(chunk);
                this.logger.debug(`➡️ Sent ${chunk.length} bytes PCM to Deepgram via ffmpeg`);
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

    private handleDeepgramTranscript(client: WebSocket, transcript: string) {
        this.logger.log(`Deepgram transcript: "${transcript}"`);
        const session = this.sessions.get(client);
        if (!session) {
            this.logger.warn('Transcript arrived but session missing');
            return;
        }
        try {
            session.client.send(JSON.stringify({ type: 'transcript', text: transcript }));
            this.logger.log('Transcript forwarded to client');
        } catch (err) {
            this.logger.error('Error forwarding transcript to client', err as any);
        }

        // Now LLM reply
        (async () => {
            try {
                // const botReply = await this.llm.generateResponse([
                //   { role: 'system', content: 'You are a helpful agent.' },
                //   { role: 'user', content: transcript },
                // ]);

                const botReply = await this.llm.generateResponse([
                    {
                        role: 'system',
                        content: `You are a friendly and professional hotel booking assistant for **Axion Hotel**. 
- Location: Lake City.  
- Your job: help guests book rooms, answer questions about availability, check-in/check-out times, and services.  
- Speak in a natural, conversational tone (like a real human receptionist).  
- Always guide the user politely and keep responses short and clear.`
                    },
                    {
                        role: 'user',
                        content: transcript, // user's spoken text
                    },
                ]);
                session.client.send(JSON.stringify({ type: 'bot_text', text: botReply }));
                this.logger.log('bot_text sent to client');
            } catch (e) {
                this.logger.error('LLM generateResponse error', e as any);
                try {
                    session.client.send(JSON.stringify({ type: 'error', message: 'LLM error' }));
                } catch (_) { }
            }
        })();
    }

    endSession(client: WebSocket) {
        const session = this.sessions.get(client);
        if (session) {
            this.logger.log('Ending session for client');
            try { session.ffmpeg?.stdin.end(); } catch (_) { }
            try { session.ffmpeg?.kill('SIGKILL'); } catch (_) { }
            try { session.dgSocket.close(); } catch (_) { }
            this.sessions.delete(client);
        }
    }
}



