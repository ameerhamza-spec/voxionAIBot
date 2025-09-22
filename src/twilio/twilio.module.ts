import { Module } from '@nestjs/common';
import { TwilioController } from './twilio.controller';
import { TwilioService } from './twilio.service';
import { DeepgramModule } from '../deepgram/deepgram.module';
import { AudioModule } from '../audio/audio.module';
import { LlmModule } from '../llm/llm.module';
import { TwilioWebSocketGateway } from './twilio/twilio.gateway';
import { ElevenlabsModule } from 'src/elevenlabs/elevenlabs.module';

@Module({
  imports: [DeepgramModule, AudioModule, LlmModule, ElevenlabsModule],
  controllers: [TwilioController],
  providers: [TwilioService, TwilioWebSocketGateway],
  exports: [TwilioService],
})
export class TwilioModule {}