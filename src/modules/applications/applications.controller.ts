import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApplicationsService } from "./applications.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { UserRole } from "../../entities";

const REVIEWERS = [
  UserRole.MANAGER,
  UserRole.ACCOUNTS_MANAGER,
  UserRole.STUDENT_AFFAIR,
  UserRole.REGISTRAR,
  UserRole.RECORD_ROOM,
  UserRole.EXAM,
];

@UseGuards(JwtAuthGuard)
@Controller("applications")
export class ApplicationsController {
  constructor(private appsService: ApplicationsService) {}

  @Get()
  findAll(
    @Query("search") search?: string,
    @Query("mine") mine?: string,
    @Query("assignedToMe") assignedToMe?: string,
    @CurrentUser() user?: any,
  ) {
    const createdByUserId = mine === "true" ? user?.id : undefined;
    const assignedToUserId = assignedToMe === "true" ? user?.id : undefined;
    return this.appsService.findAll(search, createdByUserId, assignedToUserId);
  }

  @Get("pending")
  findPending() {
    return this.appsService.findPending();
  }

  @Get("student/:studentId/fine-totals")
  fineTotals(@Param("studentId") studentId: string) {
    return this.appsService.fineTotalsForStudent(studentId);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.appsService.findOne(id);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.DATA_ENTRY, UserRole.MANAGER, UserRole.REGISTRAR)
  @Post()
  create(@Body() body: any, @CurrentUser() user: any) {
    return this.appsService.create(body, user);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.DATA_ENTRY, UserRole.MANAGER, UserRole.REGISTRAR)
  @Patch(":id/photo")
  updatePhoto(
    @Param("id") id: string,
    @Body() body: { photoBase64?: string | null; photoMimeType?: string },
    @CurrentUser() user: any,
  ) {
    return this.appsService.updatePhoto(id, body, user);
  }

  @UseGuards(RolesGuard)
  @Roles(...REVIEWERS, UserRole.DATA_ENTRY)
  @Post(":id/actions")
  addAction(
    @Param("id") id: string,
    @Body() body: any,
    @CurrentUser() user: any,
  ) {
    return this.appsService.addAction(id, body, user);
  }

  @UseGuards(RolesGuard)
  @Roles(...REVIEWERS)
  @Patch("actions/:actionId")
  updateAction(
    @Param("actionId") actionId: string,
    @Body() body: any,
    @CurrentUser() user: any,
  ) {
    return this.appsService.updateAction(actionId, body, user);
  }

  @UseGuards(RolesGuard)
  @Roles(...REVIEWERS)
  @Delete("actions/:actionId")
  deleteAction(@Param("actionId") actionId: string, @CurrentUser() user: any) {
    return this.appsService.deleteAction(actionId, user);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.REGISTRAR)
  @Post(":id/assign-stage")
  assignStage(
    @Param("id") id: string,
    @Body()
    body: { stage: number; assignedToUserId: string; assignedRole: string },
    @CurrentUser() user: any,
  ) {
    return this.appsService.assignStage(
      id,
      Number(body.stage),
      body.assignedToUserId,
      body.assignedRole,
      user,
    );
  }

  @Post(":id/accept-stage")
  acceptStage(@Param("id") id: string, @CurrentUser() user: any) {
    return this.appsService.acceptStage(id, user);
  }

  @Post(":id/issues")
  raiseIssue(
    @Param("id") id: string,
    @Body() body: { message: string },
    @CurrentUser() user: any,
  ) {
    return this.appsService.raiseIssue(id, body.message, user);
  }

  @Post("issues/:issueId/resolve")
  resolveIssue(@Param("issueId") issueId: string, @CurrentUser() user: any) {
    return this.appsService.resolveIssue(issueId, user);
  }

  @Post(":id/mark-done")
  markDone(@Param("id") id: string, @CurrentUser() user: any) {
    return this.appsService.markDone(id, user);
  }

  @UseGuards(RolesGuard)
  @Roles(...REVIEWERS)
  @Post(":id/decide")
  decide(
    @Param("id") id: string,
    @Body() body: { decision: "Accepted" | "Rejected"; reason?: string },
    @CurrentUser() user: any,
  ) {
    return this.appsService.decide(id, body.decision, body.reason, user);
  }
}
