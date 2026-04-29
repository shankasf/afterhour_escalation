import { NestFactory, HttpAdapterHost } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { WebsocketGateway } from './websocket/websocket.gateway';
import { JsonLogger } from './common/logging/json-logger';
import { GlobalExceptionFilter } from './common/logging/global-exception.filter';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true, // Buffer logs until custom logger is ready
  });

  // Get WebSocket gateway and wire it into the structured logger so log
  // entries continue to fan out to the live dashboard.
  const wsGateway = app.get(WebsocketGateway);
  JsonLogger.setGateway(wsGateway);

  const logger = new JsonLogger('NestApplication');
  app.useLogger(logger);

  // Security
  app.use(helmet());

  // CORS
  // Allowlist: 4 production subdomains + legacy FRONTEND_URL + optional
  // CORS_ORIGINS env (comma-separated) for deploy-time overrides.
  const defaultOrigins = [
    'https://main.amsterdamhostel.cloud',
    'https://customer.amsterdamhostel.cloud',
    'https://admin.amsterdamhostel.cloud',
    'https://technician.amsterdamhostel.cloud',
  ];
  const envOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const legacy = process.env.FRONTEND_URL || 'http://localhost:5175';
  const allowedOrigins = Array.from(
    new Set<string>([...defaultOrigins, ...envOrigins, legacy]),
  );
  app.enableCors({
    origin: allowedOrigins,
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

  // Global exception filter - logs every uncaught exception with
  // correlation id and request context before responding.
  const httpAdapterHost = app.get(HttpAdapterHost);
  app.useGlobalFilters(new GlobalExceptionFilter(httpAdapterHost));

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
