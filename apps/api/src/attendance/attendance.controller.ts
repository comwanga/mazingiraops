import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  attendanceQuerySchema,
  checkInSchema,
  correctAttendanceSchema,
  createAttendanceSessionSchema,
  extendAttendanceSessionSchema,
  manualAttendanceSchema,
  reviewAttendanceAbsenceSchema,
  rosterQuerySchema,
} from "@ward-ops/validation";
import { Public } from "../common/public.decorator";
import { RequireCapability } from "../authorization/capability.decorator";
import { CurrentUser, AuthContext } from "../auth/auth-context";
import { AttendanceService } from "./attendance.service";

@Controller("attendance")
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @RequireCapability("ATTENDANCE_MANAGE")
  @Post("sessions")
  createSession(
    @Body() body: unknown,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    const input = createAttendanceSessionSchema.parse(body);
    return this.attendance.createSession(auth!, input, {
      sourceIp: request.ip,
      requestId: request.headers["x-request-id"] as string | undefined,
    });
  }

  @RequireCapability("ATTENDANCE_READ")
  @Get("sessions")
  listSessions(@Query() query: Record<string, string>, @CurrentUser() auth: AuthContext | undefined) {
    const input = attendanceQuerySchema.parse(query);
    return this.attendance.listSessions(auth!, input);
  }

  @RequireCapability("ATTENDANCE_READ")
  @Get("sessions/:id")
  getSession(@Param("id") id: string, @CurrentUser() auth: AuthContext | undefined) {
    return this.attendance.getSession(auth!, id);
  }

  @RequireCapability("ATTENDANCE_MANAGE")
  @HttpCode(HttpStatus.OK)
  @Post("sessions/:id/close")
  closeSession(
    @Param("id") id: string,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    return this.attendance.closeSession(auth!, id, false, {
      sourceIp: request.ip,
      requestId: request.headers["x-request-id"] as string | undefined,
    });
  }

  @RequireCapability("ATTENDANCE_MANAGE")
  @HttpCode(HttpStatus.OK)
  @Post("sessions/:id/revoke")
  revokeSession(
    @Param("id") id: string,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    return this.attendance.closeSession(auth!, id, true, {
      sourceIp: request.ip,
      requestId: request.headers["x-request-id"] as string | undefined,
    });
  }

  @RequireCapability("ATTENDANCE_MANAGE")
  @HttpCode(HttpStatus.OK)
  @Post("sessions/:id/extend")
  extendSession(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    const input = extendAttendanceSessionSchema.parse(body);
    return this.attendance.extendSession(auth!, id, input, {
      sourceIp: request.ip,
      requestId: request.headers["x-request-id"] as string | undefined,
    });
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post("sessions/:token/check-in")
  checkIn(@Param("token") token: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    const input = checkInSchema.parse({ ...(body as object), sessionToken: token });
    return this.attendance.checkIn(input, {
      sourceIp: request.ip,
      requestId: request.headers["x-request-id"] as string | undefined,
    });
  }

  @RequireCapability("ATTENDANCE_MANAGE")
  @Post("manual")
  manual(
    @Body() body: unknown,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    const input = manualAttendanceSchema.parse(body);
    return this.attendance.manual(auth!, input, {
      sourceIp: request.ip,
      requestId: request.headers["x-request-id"] as string | undefined,
    });
  }

  @RequireCapability("ATTENDANCE_MANAGE")
  @HttpCode(HttpStatus.OK)
  @Post(":id/corrections")
  correct(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    const input = correctAttendanceSchema.parse(body);
    return this.attendance.correct(auth!, id, input, {
      sourceIp: request.ip,
      requestId: request.headers["x-request-id"] as string | undefined,
    });
  }

  @RequireCapability("ATTENDANCE_MANAGE")
  @HttpCode(HttpStatus.OK)
  @Post(":id/absence-review")
  reviewAbsence(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    const input = reviewAttendanceAbsenceSchema.parse(body);
    return this.attendance.reviewAbsence(auth!, id, input, {
      sourceIp: request.ip,
      requestId: request.headers["x-request-id"] as string | undefined,
    });
  }

  @RequireCapability("ATTENDANCE_READ")
  @Get()
  listAttendance(@Query() query: Record<string, string>, @CurrentUser() auth: AuthContext | undefined) {
    const input = attendanceQuerySchema.parse(query);
    return this.attendance.listAttendance(auth!, input);
  }

  @RequireCapability("ATTENDANCE_READ")
  @Get("roster")
  roster(@Query() query: Record<string, string>, @CurrentUser() auth: AuthContext | undefined) {
    const input = rosterQuerySchema.parse(query);
    return this.attendance.roster(auth!, input);
  }
}
