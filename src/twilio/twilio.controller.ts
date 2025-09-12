import { Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';

@Controller('twilio')
export class TwilioController {
  constructor(private readonly configService: ConfigService) {}

  @Post('incoming-call')
  handleIncomingCall(@Res() res: Response) {
    const serverBaseUrl = this.configService.get<string>('server.baseUrl');
    let domain = serverBaseUrl || 'localhost:3000';
    domain = domain.replace(/^https?:\/\//, '');

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
<Connect>
<Stream url="wss://${domain}/call" bidirectional="true"/>
</Connect>
</Response>`;

    res.type('text/xml');
    res.send(twiml);
  }
}