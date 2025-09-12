import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Twilio from 'twilio';

@Injectable()
export class TwilioService implements OnModuleInit {
  private readonly logger = new Logger(TwilioService.name);
  private twilioClient: Twilio.Twilio;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const accountSid = this.configService.get<string>('twilio.accountSid');
    const authToken = this.configService.get<string>('twilio.authToken');

    if (!accountSid || !authToken) {
      throw new Error('Twilio credentials are not configured properly');
    }

    this.twilioClient = Twilio(accountSid, authToken);
    this.logger.log('Twilio client initialized');
  }

  getClient(): Twilio.Twilio {
    return this.twilioClient;
  }

  getTwilioPhoneNumber(): string {
    return this.configService.get<string>('twilio.phoneNumber') || '';
  }
}
