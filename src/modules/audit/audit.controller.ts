import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AuditService } from "./audit.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "../../entities";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("audit")
export class AuditController {
  constructor(private auditService: AuditService) {}

  @Roles(UserRole.MANAGER, UserRole.REGISTRAR)
  @Get()
  findAll(
    @Query("studentId") studentId?: string,
    @Query("userId") userId?: string,
    @Query("module") module?: string,
  ) {
    return this.auditService.findAll({
      studentId,
      performedByUserId: userId,
      module,
    });
  }
}
