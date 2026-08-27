import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { SlipsService } from "./slips.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { User } from "../../entities";

// No RolesGuard here on purpose — same as the existing "Generate Slip"
// button on ApplicationDetail, any signed-in staff member who can view an
// application can print/re-look-up its slip.
@UseGuards(JwtAuthGuard)
@Controller("slips")
export class SlipsController {
  constructor(private slipsService: SlipsService) {}

  @Post()
  create(@Body() body: any, @CurrentUser() user: User) {
    return this.slipsService.create(body, user);
  }

  @Get(":serialNumber")
  findOne(@Param("serialNumber") serialNumber: string) {
    return this.slipsService.findBySerial(Number(serialNumber));
  }
}
