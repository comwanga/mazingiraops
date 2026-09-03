import { Body, Controller, Get, Header, Param, Post, Query, Req, Res, StreamableFile } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  reportAiDraftSchema,
  reportFinalizeSchema,
  reportPreviewQuerySchema,
  reportQuerySchema,
} from "@ward-ops/validation";
import { RequireCapability } from "../authorization/capability.decorator";
import { CurrentUser, AuthContext } from "../auth/auth-context";
import { ReportService, RequestMeta } from "./report.service";

function meta(request: FastifyRequest): RequestMeta {
  return {
    sourceIp: request.ip,
    requestId: request.headers["x-request-id"] as string | undefined,
  };
}

@Controller("reports")
export class ReportController {
  constructor(private readonly reports: ReportService) {}

  @RequireCapability("REPORTS_READ")
  @Get()
  async list(
    @Query() query: Record<string, string>,
    @CurrentUser() auth: AuthContext | undefined,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const input = reportQuerySchema.parse(query);
    const result = await this.reports.list(auth!, input);
    response.header("x-total-count", String(result.total));
    response.header("x-page", String(result.page));
    response.header("x-page-size", String(result.pageSize));
    return result.items;
  }

  @RequireCapability("REPORTS_GENERATE")
  @Get("preview")
  preview(@Query() query: Record<string, string>, @CurrentUser() auth: AuthContext | undefined) {
    const input = reportPreviewQuerySchema.parse(query);
    return this.reports.preview(auth!, input);
  }

  @RequireCapability("REPORTS_GENERATE")
  @Post("ai-draft")
  aiDraft(
    @Body() body: unknown,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    const input = reportAiDraftSchema.parse(body);
    return this.reports.aiDraft(auth!, input, meta(request));
  }

  @RequireCapability("REPORTS_FINALIZE")
  @Post()
  finalize(
    @Body() body: unknown,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    const input = reportFinalizeSchema.parse(body);
    return this.reports.finalize(auth!, input, meta(request));
  }

  @RequireCapability("REPORTS_READ")
  @Header("Cache-Control", "private, no-store")
  @Get(":id/evidence/:evidenceId")
  async evidence(
    @Param("id") id: string,
    @Param("evidenceId") evidenceId: string,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    const result = await this.reports.downloadEvidence(auth!, id, evidenceId, meta(request));
    return new StreamableFile(result.buffer, {
      type: result.contentType,
      disposition: `inline; filename="${result.filename}"`,
    });
  }

  @RequireCapability("REPORTS_READ")
  @Get(":id")
  get(@Param("id") id: string, @CurrentUser() auth: AuthContext | undefined) {
    return this.reports.get(auth!, id);
  }

  @RequireCapability("REPORTS_READ")
  @Header("Cache-Control", "private, no-store")
  @Get(":id/pdf")
  async pdf(
    @Param("id") id: string,
    @Query("disposition") disposition: string | undefined,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    const disp = disposition === "attachment" ? "attachment" : "inline";
    const result = await this.reports.getPdf(auth!, id, disp, meta(request));
    return new StreamableFile(result.buffer, {
      type: "application/pdf",
      disposition: `${disp}; filename="${result.filename}"`,
    });
  }

  @RequireCapability("REPORTS_EXPORT")
  @Get(":id/csv")
  async csv(
    @Param("id") id: string,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    const result = await this.reports.exportCsv(auth!, id, meta(request));
    return new StreamableFile(result.buffer, {
      type: "text/csv; charset=utf-8",
      disposition: `attachment; filename="${result.filename}"`,
    });
  }
}
