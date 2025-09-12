import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(private readonly configService: ConfigService) {}

  async generateResponse(messages: { role: string; content: string }[]): Promise<string> {
    const apiKey = this.configService.get<string>('groq.apiKey');
    const baseUrl = this.configService.get<string>('groq.baseUrl');
    const model = this.configService.get<string>('groq.model');

    try {
      const response = await axios.post(
        `${baseUrl}/chat/completions`,
        {
          model,
          messages,
          temperature: 0.7,
          max_tokens: 150, // Limit response length
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000, // 10 second timeout
        },
      );

      return response.data.choices[0].message.content;
    } catch (error) {
      this.logger.error('Error calling Groq API:', error.response?.data || error.message);
      throw new Error('Groq API call failed');
    }
  }
}




