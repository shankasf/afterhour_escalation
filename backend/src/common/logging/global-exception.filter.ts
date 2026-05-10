import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Request } from 'express';
import { getCorrelationId } from './correlation-id.context';

/**
 * Catches every uncaught exception, logs it as a structured error
 * record (message, stack, route, correlation id), and then forwards a
 * normal HTTP response to the client. Mirrors NestJS's default
 * BaseExceptionFilter response shape so existing clients still see
 * the same payloads.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse();

    const isHttp = exception instanceof HttpException;
    const status = isHttp
      ? (exception as HttpException).getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const errMessage =
      exception instanceof Error ? exception.message : String(exception);
    const stack =
      exception instanceof Error ? exception.stack : undefined;

    const logPayload = {
      message: `Unhandled exception: ${errMessage}`,
      method: req?.method,
      url: req?.originalUrl || req?.url,
      statusCode: status,
      correlationId: getCorrelationId(),
      error: errMessage,
      stack,
    };

    if (status >= 500) {
      this.logger.error(logPayload);
    } else {
      this.logger.warn(logPayload);
    }

    // Build the response body: preserve HttpException payloads as-is so
    // existing clients keep working; synthesize a generic 500 envelope
    // for everything else.
    const httpAdapter = this.httpAdapterHost?.httpAdapter;
    if (!httpAdapter) {
      // No adapter available (unlikely) - re-throw so Nest handles it.
      throw exception as Error;
    }

    let body: unknown;
    if (isHttp) {
      body = (exception as HttpException).getResponse();
    } else {
      body = {
        statusCode: status,
        message: 'Internal server error',
        timestamp: new Date().toISOString(),
        path: req?.originalUrl || req?.url,
      };
    }

    httpAdapter.reply(res, body, status);
  }
}
