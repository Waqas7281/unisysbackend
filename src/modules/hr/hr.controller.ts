import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { HrService } from './hr.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../entities';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.HR, UserRole.MANAGER, UserRole.REGISTRAR)
@Controller('hr')
export class HrController {
  constructor(private hrService: HrService) {}

  // ---- Staff ----
  @Get('staff')
  findAllStaff(@Query() query: any) {
    return this.hrService.findAllStaff({ search: query.search, status: query.status });
  }

  @Get('staff/:id')
  findOneStaff(@Param('id') id: string) {
    return this.hrService.findOneStaff(id);
  }

  @Roles(UserRole.HR, UserRole.MANAGER)
  @Post('staff')
  createStaff(@Body() body: any, @CurrentUser() user: any) {
    return this.hrService.createStaff(body, user.id);
  }

  @Roles(UserRole.HR, UserRole.MANAGER)
  @Patch('staff/:id')
  updateStaff(@Param('id') id: string, @Body() body: any) {
    return this.hrService.updateStaff(id, body);
  }

  @Roles(UserRole.HR, UserRole.MANAGER)
  @Delete('staff/:id')
  removeStaff(@Param('id') id: string) {
    return this.hrService.removeStaff(id);
  }

  @Get('dashboard-summary')
  dashboardSummary() {
    return this.hrService.dashboardSummary();
  }

  // ---- Staff Applications ----
  @Get('staff/:staffId/applications')
  findApplications(@Param('staffId') staffId: string) {
    return this.hrService.findApplicationsForStaff(staffId);
  }

  @Roles(UserRole.HR, UserRole.MANAGER)
  @Post('applications')
  createApplication(@Body() body: any, @CurrentUser() user: any) {
    return this.hrService.createApplication(body, user.id);
  }

  @Roles(UserRole.HR, UserRole.MANAGER)
  @Patch('applications/:id')
  updateApplication(@Param('id') id: string, @Body() body: any) {
    return this.hrService.updateApplication(id, body);
  }

  @Roles(UserRole.HR, UserRole.MANAGER)
  @Delete('applications/:id')
  removeApplication(@Param('id') id: string) {
    return this.hrService.removeApplication(id);
  }

  // ---- Staff Leaves / Offs ----
  @Get('staff/:staffId/leaves')
  findLeaves(@Param('staffId') staffId: string) {
    return this.hrService.findLeavesForStaff(staffId);
  }

  @Roles(UserRole.HR, UserRole.MANAGER)
  @Post('leaves')
  upsertLeave(@Body() body: any) {
    return this.hrService.upsertLeave(body);
  }
}
