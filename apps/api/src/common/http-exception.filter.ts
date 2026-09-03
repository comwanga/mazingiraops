import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

function codeFromHttpStatus(status: number): string {
  const codes: Record<number, string> = {
    [HttpStatus.BAD_REQUEST]: "BAD_REQUEST",
    [HttpStatus.UNAUTHORIZED]: "UNAUTHORIZED",
    [HttpStatus.FORBIDDEN]: "FORBIDDEN",
    [HttpStatus.NOT_FOUND]: "NOT_FOUND",
    [HttpStatus.CONFLICT]: "CONFLICT",
    [HttpStatus.UNPROCESSABLE_ENTITY]: "VALIDATION_FAILED",
    [HttpStatus.TOO_MANY_REQUESTS]: "RATE_LIMITED",
  };
  return codes[status] ?? "REQUEST_FAILED";
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("ExceptionFilter");

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<FastifyRequest>();
    const reply = ctx.getResponse<FastifyReply>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = "INTERNAL_ERROR";
    let message = "An unexpected error occurred.";
    let details: Record<string, unknown> | undefined;
    let extra: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = codeFromHttpStatus(status);
      const response = exception.getResponse();
      if (typeof response === "string") {
        message = response;
      } else if (response && typeof response === "object") {
        const body = response as Record<string, unknown>;
        if (typeof body["message"] === "string") {
          message = body["message"];
        } else if (Array.isArray(body["message"])) {
          message = "Validation failed";
          details = { violations: body["message"] };
        }
        if (typeof body["code"] === "string") {
          code = body["code"] as string;
        }
        if (body["details"]) {
          details = body["details"] as Record<string, unknown>;
        }
        extra = Object.fromEntries(
          Object.entries(body).filter(
            ([key]) => !["message", "code", "statusCode", "error", "details"].includes(key),
          ),
        );
      }
    } else if (exception instanceof ZodError) {
      status = HttpStatus.UNPROCESSABLE_ENTITY;
      code = "VALIDATION_FAILED";
      message = "Validation failed";
      details = {
        violations: exception.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      };
    } else {
      this.logger.error(
        `Unhandled exception for ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    reply.status(status).send({
      error: {
        code,
        message,
        ...(details ? { details } : {}),
        ...extra,
      },
      ...extra,
    });
  }
}
