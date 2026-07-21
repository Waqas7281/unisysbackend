import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ClearanceService } from "./clearance.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { UserRole, User } from "../../entities";

@UseGuards(JwtAuthGuard)
@Controller("clearance")
export class ClearanceController {
  constructor(private clearanceService: ClearanceService) {}

  // Search a student by enrollment number and get their full fee summary,
  // for the Accounts Manager to review before generating a slip.
  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.ACCOUNTS_MANAGER, UserRole.REGISTRAR)
  @Get("search")
  search(@Query("enrollmentNumber") enrollmentNumber: string) {
    return this.clearanceService.searchStudent(enrollmentNumber);
  }

  // Generates a new clearance slip (valid 10 days) for the given student.
  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.ACCOUNTS_MANAGER)
  @Post("generate")
  generate(
    @Body()
    body: { studentId: string; term: string; backgroundColor?: string },
    @CurrentUser() user: User,
  ) {
    return this.clearanceService.generateSlip(
      body.studentId,
      body.term,
      body.backgroundColor,
      user?.id,
    );
  }

  // Verifies a scanned slip token. Open to any authenticated staff role that
  // might be stationed at an exam gate scanning slips, not just Accounts.
  @UseGuards(RolesGuard)
  @Roles(
    UserRole.MANAGER,
    UserRole.ACCOUNTS_MANAGER,
    UserRole.STUDENT_AFFAIR,
    UserRole.REGISTRAR,
  )
  @Post("verify/:token")
  verify(@Param("token") token: string) {
    return this.clearanceService.verifyToken(token);
  }
}
