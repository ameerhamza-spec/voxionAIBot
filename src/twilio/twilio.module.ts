import { Module } from '@nestjs/common';
import { TwilioController } from './twilio.controller';
import { TwilioService } from './twilio.service';
import { DeepgramModule } from '../deepgram/deepgram.module';
import { AudioModule } from '../audio/audio.module';
import { LlmModule } from '../llm/llm.module';
import { TwilioWebSocketGateway } from './twilio/twilio.gateway';

@Module({
  imports: [DeepgramModule, AudioModule, LlmModule],
  controllers: [TwilioController],
  providers: [TwilioService, TwilioWebSocketGateway],
  exports: [TwilioService],
})
export class TwilioModule {}