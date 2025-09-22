import { Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';

@Controller('twilio') // Base route: /twilio
export class TwilioController {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Handle an incoming call webhook from Twilio.
   * 
   * Route: POST /twilio/incoming-call
   * 
   * Input:
   *   - HTTP POST request from Twilio (contains call info, but not used here)
   *   - @Res() res: Express Response object → to send XML back to Twilio
   * 
   * Output:
   *   - XML (TwiML response) telling Twilio what to do with the call.
   *   - In this case: connect the call audio stream to our WebSocket server.
   */
  @Post('incoming-call')
  handleIncomingCall(@Res() res: Response) {
    // Get server base URL from config (e.g., https://myserver.com)
    const serverBaseUrl = this.configService.get<string>('server.baseUrl');

    // Default to localhost:3000 if not set
    let domain = serverBaseUrl || 'localhost:3000';

    // Remove "http://" or "https://" prefix for WebSocket domain
    domain = domain.replace(/^https?:\/\//, '');

    // TwiML XML response → tells Twilio to connect the audio stream
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${domain}/call" bidirectional="true"/>
  </Connect>
</Response>`;

    // Respond with XML so Twilio knows how to handle the call
    res.type('text/xml');
    res.send(twiml);
  }
}
