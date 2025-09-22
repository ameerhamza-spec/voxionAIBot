import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { WebSocket, Server, Data } from 'ws';
import { PlaygroundService } from 'src/playground/playground.service';

// WebSocket Gateway mounted at ws://<host>/playground
// CORS enabled so browsers can connect.
@WebSocketGateway({ path: '/playground', cors: true })
export class PlaygroundGateway implements OnGatewayConnection, OnGatewayDisconnect {
  // Underlying WebSocket server instance
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(PlaygroundGateway.name);

  constructor(private readonly playgroundService: PlaygroundService) {}

  /**
   * Called when a new client connects to the WS server.
   * 
   * Input: client (WebSocket connection)
   * Output: none directly, but:
   *   - Logs connection
   *   - Sets up message handlers
   *   - Sends a "welcome" message back to the client
   */
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

  /**
   * Called when client disconnects.
   * 
   * Input: client (WebSocket)
   * Output: none directly, but cleans up session via PlaygroundService
   */
  handleDisconnect(client: WebSocket) {
    this.logger.log('Client disconnected');
    this.playgroundService.endSession(client);
  }

  /**
   * Sets up handlers for messages/events from the client.
   * Handles both JSON text messages and binary audio data.
   * 
   * Input: 
   *   - Text messages (JSON with type: 'register' | 'stop')
   *   - Binary audio buffers (PCM or encoded audio chunks)
   * Output:
   *   - Calls service methods (startSession, handleAudio, endSession)
   *   - May send error responses back to client
   */
  setupClientMessageHandler(client: WebSocket) {
    // Handle incoming messages
    client.on('message', async (data: Data) => {
      try {
        let parsedTextMsg: any = null;

        // --- 1. Try to parse JSON messages ---
        if (typeof data === 'string') {
          parsedTextMsg = JSON.parse(data);
        } else if (Buffer.isBuffer(data)) {
          const maybe = data.toString('utf8').trim();
          if (maybe.startsWith('{')) parsedTextMsg = JSON.parse(maybe);
        } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
          const buf = Buffer.from(data instanceof ArrayBuffer ? data : (data as any).buffer);
          const str = buf.toString('utf8').trim();
          if (str.startsWith('{')) parsedTextMsg = JSON.parse(str);
        }

        // --- 2. Handle JSON messages (control messages) ---
        if (parsedTextMsg && parsedTextMsg.type) {
          this.logger.log(`WS text message type=${parsedTextMsg.type}`);

          if (parsedTextMsg.type === 'register') {
            // Start a new audio session, e.g., sampleRate=48000
            await this.playgroundService.startSession(client, 48000);
          } else if (parsedTextMsg.type === 'stop') {
            // Stop current session
            this.playgroundService.endSession(client);
          } else {
            this.logger.debug('Unhandled text message', parsedTextMsg);
          }
          return; // Stop here if it was text
        }

        // --- 3. Handle binary messages (audio chunks) ---
        const isBinary = Buffer.isBuffer(data) || data instanceof ArrayBuffer || ArrayBuffer.isView(data);

        if (isBinary) {
          let buf: Buffer;
          if (Buffer.isBuffer(data)) {
            buf = data;
          } else if (data instanceof ArrayBuffer) {
            buf = Buffer.from(data);
          } else {
            // TypedArray or other view
            buf = Buffer.from((data as any).buffer);
          }

          this.logger.debug(`Binary audio chunk received: ${buf.length} bytes`);
          await this.playgroundService.handleAudio(client, buf);
        } else {
          // Ignore anything else (unsupported format)
          this.logger.warn('Received message non-text non-binary, ignored');
        }

      } catch (err: any) {
        this.logger.error(`Error in client message handler: ${err?.message ?? err}`);
        try {
          client.send(JSON.stringify({ type: 'error', message: 'Processing error' }));
        } catch (_) {}
      }
    });

    // Handle connection close event
    client.on('close', (code, reason) => {
      this.logger.log(`Client WS closed: ${code} - ${reason?.toString() ?? ''}`);
      this.playgroundService.endSession(client);
    });

    // Handle client WS errors
    client.on('error', (err) => {
      this.logger.error('Client WS error', err as any);
      this.playgroundService.endSession(client);
    });
  }
}
