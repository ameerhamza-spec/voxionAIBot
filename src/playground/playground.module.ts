import { Module } from '@nestjs/common';
import { PlaygroundGateway } from '../playground-gateway/playground.gateway';
import { PlaygroundService } from './playground.service';
import { PlaygroundDeepgramService } from './playground-deepgram/playground-deepgram.service';
import { DeepgramModule } from '../deepgram/deepgram.module';
import { LlmModule } from '../llm/llm.module';
import { AudioModule } from '../audio/audio.module';

@Module({
  imports: [DeepgramModule, LlmModule, AudioModule],
  providers: [PlaygroundGateway, PlaygroundService, PlaygroundDeepgramService],
})
export class PlaygroundModule {}