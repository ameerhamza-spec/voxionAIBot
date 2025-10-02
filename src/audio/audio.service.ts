// // src/audio/audio.service.ts
// import { Injectable } from '@nestjs/common';
// import * as fs from 'fs';
// import * as path from 'path';

// @Injectable()
// export class AudioService {
//     /**
//      * Converts input text into audio using Deepgram TTS (Text-to-Speech).
//      * 
//      * @param text The text string you want to convert into speech.
//      * @returns A Promise that resolves to a Base64-encoded μ-law audio string.
//      *          (⚠️ Required format for Twilio voice streaming).
//      */
//     async textToAudio(text: string): Promise<string> {
//         console.time('TTS Request Time'); // 🕒 Start timing

//         const response = await fetch(
//             'https://api.deepgram.com/v1/speak?model=aura-2-andromeda-en&encoding=mulaw&sample_rate=8000',
//             {
//                 method: 'POST',
//                 headers: {
//                     Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
//                     'Content-Type': 'application/json',
//                 },
//                 body: JSON.stringify({ text }),
//             },
//         );

//         if (!response.ok) {
//             throw new Error(
//                 `Deepgram TTS failed: ${response.status} ${response.statusText}`,
//             );
//         }

//         const arrayBuffer = await response.arrayBuffer();
//         const buffer = Buffer.from(arrayBuffer);

//         console.timeEnd('TTS Request Time'); // 🕒 End timing and log duration

//         return buffer.toString('base64'); 
//     }

//     async saveAudioToFile(base64Mulaw: string, filename: string) {
//         const buffer = Buffer.from(base64Mulaw, 'base64');
//         const outPath = path.join('recordings', filename);

//         fs.writeFileSync(outPath, buffer);
//         return outPath;
//     }
// }








// src/audio/audio.service.ts

import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class AudioService {
  private readonly logger = new Logger(AudioService.name);
  private readonly responseCache = new Map<string, string>();

  /**
   * Convert text to audio using Deepgram TTS (Standard - for backward compatibility)
   */
  async textToAudio(text: string): Promise<string> {
    const cacheKey = text.toLowerCase().trim();
    
    // Check cache first
    if (this.responseCache.has(cacheKey)) {
      this.logger.log('Returning cached TTS response');
      return this.responseCache.get(cacheKey)!;
    }

    console.time('TTS Request Time');
    
    try {
      const response = await fetch(
        'https://api.deepgram.com/v1/speak?model=aura-asteria-en&encoding=mulaw&sample_rate=8000',
        {
          method: 'POST',
          headers: {
            'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text }),
        },
      );

      if (!response.ok) {
        throw new Error(`Deepgram TTS failed: ${response.status} ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const base64Audio = buffer.toString('base64');

      // Cache the response
      this.responseCache.set(cacheKey, base64Audio);
      
      console.timeEnd('TTS Request Time');
      return base64Audio;
    } catch (error) {
      this.logger.error('TTS conversion failed:', error);
      throw error;
    }
  }

  /**
   * Stream text to audio using Deepgram streaming TTS
   */
  async streamTextToAudio(text: string, onAudioChunk: (chunk: string, isFinal: boolean) => void): Promise<void> {
    this.logger.log(`Starting streaming TTS for text: ${text.substring(0, 50)}...`);
    
    try {
      const response = await fetch(
        'https://api.deepgram.com/v1/speak?model=aura-asteria-en&encoding=mulaw&sample_rate=8000',
        {
          method: 'POST',
          headers: {
            'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text }),
        },
      );

      if (!response.ok) {
        throw new Error(`Deepgram TTS failed: ${response.status} ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader available');

      const chunks: Buffer[] = [];
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          chunks.push(Buffer.from(value));
          const chunkBase64 = Buffer.from(value).toString('base64');
          
          // Send chunk to client immediately
          onAudioChunk(chunkBase64, false);
        }

        // Send final signal
        onAudioChunk('', true);
        
        // Cache the complete audio for future use
        const completeAudio = Buffer.concat(chunks).toString('base64');
        const cacheKey = text.toLowerCase().trim();
        this.responseCache.set(cacheKey, completeAudio);
        
        this.logger.log('Streaming TTS completed successfully');
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      this.logger.error('Streaming TTS failed:', error);
      throw error;
    }
  }

  /**
   * Alternative streaming with lower latency model
   */
  async streamTextToAudioFast(text: string, onAudioChunk: (chunk: string, isFinal: boolean) => void): Promise<void> {
    this.logger.log(`Starting FAST streaming TTS for text: ${text.substring(0, 50)}...`);
    
    try {
      // Using even faster model for quick responses
      const response = await fetch(
        'https://api.deepgram.com/v1/speak?model=aura-arcas-en&encoding=mulaw&sample_rate=8000',
        {
          method: 'POST',
          headers: {
            'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text }),
        },
      );

      if (!response.ok) {
        throw new Error(`Deepgram TTS failed: ${response.status} ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader available');

      let receivedFirstChunk = false;
      let firstChunkTime = Date.now();
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          if (!receivedFirstChunk) {
            receivedFirstChunk = true;
            firstChunkTime = Date.now();
            this.logger.log(`First TTS chunk received in ${firstChunkTime}ms`);
          }

          const chunkBase64 = Buffer.from(value).toString('base64');
          onAudioChunk(chunkBase64, false);
        }

        onAudioChunk('', true);
        this.logger.log(`Fast TTS streaming completed. Total time: ${Date.now() - firstChunkTime}ms`);
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      this.logger.error('Fast streaming TTS failed:', error);
      throw error;
    }
  }

  async saveAudioToFile(base64Mulaw: string, filename: string) {
    const buffer = Buffer.from(base64Mulaw, 'base64');
    const outPath = path.join('recordings', filename);

    // Ensure recordings directory exists
    if (!fs.existsSync('recordings')) {
      fs.mkdirSync('recordings', { recursive: true });
    }

    fs.writeFileSync(outPath, buffer);
    return outPath;
  }

  /**
   * Clear cache periodically to prevent memory issues
   */
  clearCache(): void {
    const previousSize = this.responseCache.size;
    this.responseCache.clear();
    this.logger.log(`Cleared TTS cache. Previous size: ${previousSize}`);
  }
}