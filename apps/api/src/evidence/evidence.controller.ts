import { BadRequestException, Controller, Get, Header, Param, Post, Query, Req, StreamableFile } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { evidenceListSchema, evidenceMetaSchema } from "@ward-ops/validation";
import { RequireCapability } from "../authorization/capability.decorator";
import { CurrentUser, AuthContext } from "../auth/auth-context";
import { EvidenceService, RequestMeta } from "./evidence.service";

function meta(request: FastifyRequest): RequestMeta {
  return {
    sourceIp: request.ip,
    requestId: request.headers["x-request-id"] as string | undefined,
  };
}

@Controller("evidence")
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  @RequireCapability("WORK_CREATE")
  @Post()
  async upload(@CurrentUser() auth: AuthContext | undefined, @Req() request: FastifyRequest) {
    if (!request.isMultipart()) {
      throw new BadRequestException("Expected a multipart photo upload");
    }
    let fileBuffer: Buffer | undefined;
    let filename = "";
    let mimetype = "";
    let workLogId = "";
    let stage = "";
    let caption = "";

    for await (const part of request.parts()) {
      if (part.type === "file") {
        if (fileBuffer) {
          throw new BadRequestException("Supply exactly one photo");
        }
        filename = part.filename;
        mimetype = part.mimetype;
        fileBuffer = await part.toBuffer();
      } else {
        if (part.fieldname === "workLogId") workLogId = String(part.value);
        if (part.fieldname === "stage") stage = String(part.value);
        if (part.fieldname === "caption") caption = String(part.value);
      }
    }

    if (!fileBuffer) {
      throw new BadRequestException("No photo supplied");
    }

    const metaInput = evidenceMetaSchema.parse({ stage, caption });
    return this.evidence.upload(
      auth!,
      workLogId,
      { buffer: fileBuffer, originalName: filename, contentType: mimetype },
      metaInput.stage,
      metaInput.caption,
      meta(request),
    );
  }

  @RequireCapability("WORK_READ")
  @Get()
  list(@Query() query: Record<string, string>, @CurrentUser() auth: AuthContext | undefined) {
    const input = evidenceListSchema.parse(query);
    return this.evidence.list(auth!, input);
  }

  @RequireCapability("WORK_READ")
  @Header("Cache-Control", "private, no-store")
  @Get(":id/download")
  async download(
    @Param("id") id: string,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    const result = await this.evidence.download(auth!, id, meta(request));
    return new StreamableFile(result.buffer, {
      type: result.contentType,
      disposition: `inline; filename="evidence-${id}.jpg"`,
    });
  }
}
