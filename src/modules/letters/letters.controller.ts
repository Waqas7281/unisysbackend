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
import { LettersService } from "./letters.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { UserRole } from "../../entities";

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.RECORD_ROOM, UserRole.MANAGER, UserRole.REGISTRAR)
@Controller("letters")
export class LettersController {
  constructor(private lettersService: LettersService) {}

  @Get("by-student/:studentId")
  findByStudent(@Param("studentId") studentId: string) {
    return this.lettersService.findByStudentId(studentId);
  }

  @Roles(UserRole.RECORD_ROOM, UserRole.MANAGER, UserRole.REGISTRAR)
  @Post()
  create(@Body() body: any, @CurrentUser() user: any) {
    return this.lettersService.create(body, user);
  }

  @Roles(UserRole.RECORD_ROOM, UserRole.MANAGER, UserRole.REGISTRAR)
  @Patch(":id")
  update(@Param("id") id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.lettersService.update(id, body, user);
  }

  @Roles(UserRole.RECORD_ROOM, UserRole.MANAGER, UserRole.REGISTRAR)
  @Delete(":id")
  remove(@Param("id") id: string, @CurrentUser() user: any) {
    return this.lettersService.remove(id, user);
  }
}
