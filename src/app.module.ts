import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TwilioModule } from './twilio/twilio.module';
import { DeepgramModule } from './deepgram/deepgram.module';
import { AudioModule } from './audio/audio.module';
import { LlmModule } from './llm/llm.module';
import configuration from './config/configuration';
import { PlaygroundModule } from './playground/playground.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [configuration],
    }),
    ScheduleModule.forRoot(),
    TwilioModule,
    DeepgramModule,
    AudioModule,
    LlmModule, 
    PlaygroundModule
  ],
})
export class AppModule {}