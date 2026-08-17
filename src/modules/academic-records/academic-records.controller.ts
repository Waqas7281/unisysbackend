import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { AcademicRecordsService } from "./academic-records.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { UserRole } from "../../entities";

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.RECORD_ROOM, UserRole.MANAGER, UserRole.REGISTRAR)
@Controller("academic-records")
export class AcademicRecordsController {
  constructor(private recordsService: AcademicRecordsService) {}

  @Get("dashboard-summary")
  dashboardSummary() {
    return this.recordsService.dashboardSummary();
  }

  @Get("by-enrollment/:enrollmentNumber")
  findByEnrollment(@Param("enrollmentNumber") enrollmentNumber: string) {
    return this.recordsService.findByEnrollment(enrollmentNumber);
  }

  @Get("by-student/:studentId")
  findByStudent(@Param("studentId") studentId: string) {
    return this.recordsService.findByStudentId(studentId);
  }

  @Roles(UserRole.RECORD_ROOM, UserRole.MANAGER, UserRole.REGISTRAR)
  @Post()
  create(@Body() body: any, @CurrentUser() user: any) {
    return this.recordsService.create(body, user);
  }

  @Roles(UserRole.RECORD_ROOM, UserRole.MANAGER, UserRole.REGISTRAR)
  @Patch(":id")
  update(@Param("id") id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.recordsService.update(id, body, user);
  }

  @Roles(UserRole.RECORD_ROOM, UserRole.MANAGER, UserRole.REGISTRAR)
  @Delete(":id")
  remove(@Param("id") id: string, @CurrentUser() user: any) {
    return this.recordsService.remove(id, user);
  }
}
