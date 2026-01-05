import { NestFactory } from '@nestjs/core';
import { ValidationPipe, ConsoleLogger, LogLevel } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { WebsocketGateway } from './websocket/websocket.gateway';
import helmet from 'helmet';

// Custom logger that forwards to WebSocket
class WebSocketLogger extends ConsoleLogger {
  private static gateway: WebsocketGateway | null = null;

  static setGateway(gateway: WebsocketGateway) {
    WebSocketLogger.gateway = gateway;
  }

  private emitToWebSocket(level: 'info' | 'warn' | 'error' | 'debug', message: string, context?: string) {
    if (WebSocketLogger.gateway) {
      const formattedMessage = context ? `[${context}] ${message}` : message;
      WebSocketLogger.gateway.emitLog('system', level, formattedMessage, { context }, 'backend');
    }
  }

  log(message: any, context?: string) {
    super.log(message, context);
    this.emitToWebSocket('info', String(message), context);
  }

  error(message: any, stack?: string, context?: string) {
    super.error(message, stack, context);
    this.emitToWebSocket('error', String(message), context);
  }

  warn(message: any, context?: string) {
    super.warn(message, context);
    this.emitToWebSocket('warn', String(message), context);
  }

  debug(message: any, context?: string) {
    super.debug(message, context);
    this.emitToWebSocket('debug', String(message), context);
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,  // Buffer logs until custom logger is ready
  });

  // Get WebSocket gateway and set it for logging
  const wsGateway = app.get(WebsocketGateway);
  WebSocketLogger.setGateway(wsGateway);

  // Use custom logger that emits to WebSocket
  const logger = new WebSocketLogger('NestApplication');
  app.useLogger(logger);

  // Security
  app.use(helmet());

  // CORS
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5175',
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // API prefix
  app.setGlobalPrefix('api');

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('After-Hours Escalation API')
    .setDescription('API for the After-Hours Maintenance Escalation System')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3004;
  await app.listen(port);

  // Log startup messages through our custom logger
  logger.log(`Backend running on http://localhost:${port}`);
  logger.log(`API Docs available at http://localhost:${port}/api/docs`);
}

bootstrap();
