import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { WebSocket, Server, Data } from 'ws';
import { PlaygroundService } from 'src/playground/playground.service';
// import { PlaygroundService } from './playground.service';

@WebSocketGateway({ path: '/playground', cors: true })
export class PlaygroundGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(PlaygroundGateway.name);

  constructor(private readonly playgroundService: PlaygroundService) {}

  handleConnection(client: WebSocket) {
    this.logger.log('Client connected');
    this.setupClientMessageHandler(client);

    try {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'welcome', message: 'Gateway connected' }));
      }
    } catch (err) {
      this.logger.warn('Failed to send welcome message to client', err as any);
    }
  }

  handleDisconnect(client: WebSocket) {
    this.logger.log('Client disconnected');
    this.playgroundService.endSession(client);
  }

  setupClientMessageHandler(client: WebSocket) {
    client.on('message', async (data: Data) => {
      try {
        let parsedTextMsg: any = null;
        if (typeof data === 'string') {
          parsedTextMsg = JSON.parse(data);
        } else if (Buffer.isBuffer(data)) {
          const maybe = data.toString('utf8').trim();
          if (maybe.startsWith('{')) {
            parsedTextMsg = JSON.parse(maybe);
          }
        } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
          const buf = Buffer.from(data instanceof ArrayBuffer ? data : (data as any).buffer);
          const str = buf.toString('utf8').trim();
          if (str.startsWith('{')) parsedTextMsg = JSON.parse(str);
        }

        if (parsedTextMsg && parsedTextMsg.type) {
          this.logger.log(`WS text message type=${parsedTextMsg.type}`);
          if (parsedTextMsg.type === 'register') {
            await this.playgroundService.startSession(client, 48000);
          } else if (parsedTextMsg.type === 'stop') {
            this.playgroundService.endSession(client);
          } else {
            this.logger.debug('Unhandled text message', parsedTextMsg);
          }
          return;
        }

        const isBinary = Buffer.isBuffer(data) || data instanceof ArrayBuffer || ArrayBuffer.isView(data);

        if (isBinary) {
          let buf: Buffer;
          if (Buffer.isBuffer(data)) {
            buf = data as Buffer;
          } else if (data instanceof ArrayBuffer) {
            buf = Buffer.from(data);
          } else {
            // TypedArray or view
            buf = Buffer.from((data as any).buffer);
          }
          this.logger.debug(`Binary audio chunk received: ${buf.length} bytes`);
          await this.playgroundService.handleAudio(client, buf);
        } else {
          this.logger.warn('Received message non-text non-binary, ignored');
        }

      } catch (err: any) {
        this.logger.error(`Error in client message handler: ${err?.message ?? err}`);
        try {
          client.send(JSON.stringify({ type: 'error', message: 'Processing error' }));
        } catch (_) {}
      }
    });

    client.on('close', (code, reason) => {
      this.logger.log(`Client WS closed: ${code} - ${reason?.toString() ?? ''}`);
      this.playgroundService.endSession(client);
    });

    client.on('error', (err) => {
      this.logger.error('Client WS error', err as any);
      this.playgroundService.endSession(client);
    });
  }
}



