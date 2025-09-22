import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Calls the Groq API to generate a chatbot response.
   * @param messages Array of conversation messages [{ role: "user" | "system" | "assistant", content: string }]
   * @returns Generated response text from the LLM
   */
  async generateResponse(messages: { role: string; content: string }[]): Promise<string> {
    // 🔑 Get API config values from NestJS ConfigService
    const apiKey = this.configService.get<string>('groq.apiKey');
    const baseUrl = this.configService.get<string>('groq.baseUrl');
    const model = this.configService.get<string>('groq.model');

    try {
      // 🌐 Make POST request to Groq API
      const response = await axios.post(
        `${baseUrl}/chat/completions`,
        {
          model,          // which AI model to use
          messages,       // conversation history
          temperature: 0.7,  // controls creativity/randomness
          max_tokens: 150,   // limit response length
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`, // API authentication
            'Content-Type': 'application/json',
          },
          timeout: 10000, // ⏳ 10 second timeout
        },
      );

      // ✅ Extract and return the assistant's message text
      return response.data.choices[0].message.content;
    } catch (error) {
      // ⚠️ Log error for debugging
      this.logger.error('Error calling Groq API:', error.response?.data || error.message);
      throw new Error('Groq API call failed'); // ❌ rethrow for caller to handle
    }
  }
}
