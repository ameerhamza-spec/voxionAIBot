import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TwilioModule } from './twilio/twilio.module';
import { DeepgramModule } from './deepgram/deepgram.module';
import { AudioModule } from './audio/audio.module';
import { LlmModule } from './llm/llm.module';
import configuration from './config/configuration';
import { PlaygroundModule } from './playground/playground.module';
import { ElevenlabsModule } from './elevenlabs/elevenlabs.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [configuration],
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'), // <-- serve public/ folder
    }),
    ScheduleModule.forRoot(),
    TwilioModule,
    DeepgramModule,
    AudioModule,
    LlmModule, 
    PlaygroundModule, ElevenlabsModule
  ],
})
export class AppModule {}