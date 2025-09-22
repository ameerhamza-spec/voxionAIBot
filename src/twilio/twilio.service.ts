import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Twilio from 'twilio';

@Injectable() // Marks this class as injectable so it can be used in NestJS DI system
export class TwilioService implements OnModuleInit {
  private readonly logger = new Logger(TwilioService.name); // Logger for debugging/info
  private twilioClient: Twilio.Twilio; // Holds the initialized Twilio client

  constructor(private readonly configService: ConfigService) {}
  // ConfigService is injected → used to fetch Twilio credentials from env/config

  /**
   * Lifecycle hook that runs when the module is initialized.
   * Purpose: initialize the Twilio client with credentials.
   * 
   * Input: none (reads values from ConfigService)
   * Output: sets up this.twilioClient for later use
   */
  onModuleInit() {
    const accountSid = this.configService.get<string>('twilio.accountSid'); // Twilio Account SID
    const authToken = this.configService.get<string>('twilio.authToken');   // Twilio Auth Token

    if (!accountSid || !authToken) {
      // If credentials are missing → throw error (service can’t work without them)
      throw new Error('Twilio credentials are not configured properly');
    }

    // Create a Twilio client instance with given credentials
    this.twilioClient = Twilio(accountSid, authToken);
    this.logger.log('Twilio client initialized');
  }

  /**
   * Get the initialized Twilio client.
   * 
   * Input: none
   * Output: Twilio.Twilio instance (used to send SMS, make calls, etc.)
   */
  getClient(): Twilio.Twilio {
    return this.twilioClient;
  }

  /**
   * Get the configured Twilio phone number from config.
   * 
   * Input: none
   * Output: string (Twilio phone number to use for calls/SMS)
   * If not set, returns an empty string.
   */
  getTwilioPhoneNumber(): string {
    return this.configService.get<string>('twilio.phoneNumber') || '';
  }
}
