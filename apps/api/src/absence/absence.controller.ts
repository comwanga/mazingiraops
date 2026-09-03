import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  StreamableFile,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  absenceActionSchema,
  absenceQuerySchema,
  createAbsenceSchema,
  documentCategorySchema,
} from "@ward-ops/validation";
import { RequireCapability } from "../authorization/capability.decorator";
import { CurrentUser, AuthContext } from "../auth/auth-context";
import { AbsenceService, RequestMeta } from "./absence.service";

function meta(request: FastifyRequest): RequestMeta {
  return {
    sourceIp: request.ip,
    requestId: request.headers["x-request-id"] as string | undefined,
  };
}

function sanitizeFilename(value: string): string {
  return value.replace(/["\\\r\n]/g, "_").slice(0, 200);
}

@Controller("absence-requests")
export class AbsenceController {
  constructor(private readonly absence: AbsenceService) {}

  @RequireCapability("ABSENCE_MANAGE")
  @Post()
  create(
    @Body() body: unknown,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    const input = createAbsenceSchema.parse(body);
    return this.absence.create(auth!, input, meta(request));
  }

  @RequireCapability("ABSENCE_READ")
  @Get()
  list(@Query() query: Record<string, string>, @CurrentUser() auth: AuthContext | undefined) {
    const input = absenceQuerySchema.parse(query);
    return this.absence.list(auth!, input);
  }

  @RequireCapability("ABSENCE_READ")
  @Get(":id")
  get(@Param("id") id: string, @CurrentUser() auth: AuthContext | undefined) {
    return this.absence.get(auth!, id);
  }

  @Post(":id/actions")
  action(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    const input = absenceActionSchema.parse(body);
    return this.absence.action(auth!, id, input, meta(request));
  }

  @RequireCapability("ABSENCE_MANAGE")
  @Post(":id/documents")
  async uploadDocument(
    @Param("id") id: string,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    if (!request.isMultipart()) {
      throw new BadRequestException("Expected a multipart file upload");
    }
    let fileBuffer: Buffer | undefined;
    let filename = "";
    let mimetype = "";
    let category = "OTHER";

    for await (const part of request.parts()) {
      if (part.type === "file") {
        if (fileBuffer) {
          throw new BadRequestException("Supply exactly one file");
        }
        filename = part.filename;
        mimetype = part.mimetype;
        fileBuffer = await part.toBuffer();
      } else if (part.fieldname === "documentCategory") {
        category = String(part.value);
      }
    }

    if (!fileBuffer) {
      throw new BadRequestException("No document file supplied");
    }

    const parsedCategory = documentCategorySchema.parse(category);
    return this.absence.uploadDocument(
      auth!,
      id,
      {
        buffer: fileBuffer,
        originalName: filename,
        contentType: mimetype,
      },
      parsedCategory,
      meta(request),
    );
  }

  @RequireCapability("ABSENCE_READ")
  @Header("Cache-Control", "private, no-store")
  @Get("documents/:documentId/download")
  async downloadDocument(
    @Param("documentId") documentId: string,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    const result = await this.absence.downloadDocument(auth!, documentId, meta(request));
    return new StreamableFile(result.buffer, {
      type: result.contentType,
      disposition: `inline; filename="${sanitizeFilename(result.originalName)}"`,
    });
  }
}
