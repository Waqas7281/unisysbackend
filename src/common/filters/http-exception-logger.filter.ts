import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionLoggerFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const now = new Date().toISOString();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: any = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      message = res;
    } else if (exception && typeof exception === 'object') {
      message = (exception as any).message ?? message;
      // eslint-disable-next-line no-console
      console.error('❌ Unhandled exception:', exception);
    }

    // eslint-disable-next-line no-console
    console.error(
      `[${now}] ${request.method} ${request.originalUrl} -> ${status}`,
      typeof message === 'string' ? message : message,
    );

    response.status(status).json({
      statusCode: status,
      message,
      timestamp: now,
      path: request.originalUrl,
    });
  }
}

