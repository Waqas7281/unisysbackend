import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { LeaveApplicationsService } from "./leave-applications.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { UserRole } from "../../entities";

// Record Room, Manager, Registrar: create, dekhna, approve / reject
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.RECORD_ROOM, UserRole.MANAGER, UserRole.REGISTRAR)
@Controller("leave-applications")
export class LeaveApplicationsController {
  constructor(private leaveService: LeaveApplicationsService) {}

  @Get()
  findAll() {
    return this.leaveService.findAll();
  }

  @Get("search-students")
  searchStudents(@Query("q") q: string) {
    return this.leaveService.searchStudents(q);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.leaveService.findOne(id);
  }

  @Post()
  create(@Body() body: any, @CurrentUser() user: any) {
    return this.leaveService.create(body, user);
  }

  @Post(":id/decide")
  decide(@Param("id") id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.leaveService.decide(id, body, user);
  }
}
