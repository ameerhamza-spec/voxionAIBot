import { Controller, Post, Body } from '@nestjs/common';
import { LlmService } from './llm.service';

@Controller('llm')
export class LlmController {
    constructor(private readonly llmService: LlmService) { }

    @Post('chat')
    async chat(@Body() body: { message: string }) {
        const response = await this.llmService.generateResponse([
            { role: 'system', content: 'You are a helpful call center agent. Always reply in short, clear, and to the point answers (1–2 sentences max).' },
            { role: 'user', content: body.message },
        ]);
        return { reply: response };
    }
}