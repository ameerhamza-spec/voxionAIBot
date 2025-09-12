import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WsAdapter } from '@nestjs/platform-ws';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // WebSocket adapter for Twilio streaming
  app.useWebSocketAdapter(new WsAdapter(app));
  
  // Enable CORS
  app.enableCors({
  origin: '*',
});
  
  // Global validation pipe
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
  }));
  
  const port = process.env.PORT || 3002;
  await app.listen(3002, '0.0.0.0');;
  console.log(`Application is running on: ${await app.getUrl()}`);
    console.log(`Playground WebSocket available at: ws://e327d5b72b08.ngrok-free.app/playground`);
}

bootstrap();