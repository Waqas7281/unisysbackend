import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import * as multer from "multer";
import { FeesService } from "./fees.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CustomFieldAppliesTo, UserRole } from "../../entities";

@UseGuards(JwtAuthGuard)
@Controller("fees")
export class FeesController {
  constructor(private feesService: FeesService) {}

  @Get("student/:studentId")
  findForStudent(@Param("studentId") studentId: string) {
    return this.feesService.findForStudent(studentId);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.ACCOUNTS_MANAGER, UserRole.REGISTRAR)
  @Post()
  addFee(@Body() body: any, @CurrentUser() user: any) {
    return this.feesService.addFee(body, user);
  }

  @UseGuards(RolesGuard)
  @Roles(
    UserRole.MANAGER,
    UserRole.STUDENT_AFFAIR,
    UserRole.ACCOUNTS_MANAGER,
    UserRole.REGISTRAR,
  )
  @Patch(":id")
  updateFee(
    @Param("id") id: string,
    @Body() body: any,
    @CurrentUser() user: any,
  ) {
    return this.feesService.updateFee(id, body, user);
  }

  @UseGuards(RolesGuard)
  @Roles(
    UserRole.MANAGER,
    UserRole.ACCOUNTS_MANAGER,
    UserRole.STUDENT_AFFAIR,
    UserRole.REGISTRAR,
  )
  @Patch(":id/status")
  updateStatus(
    @Param("id") id: string,
    @Body() body: any,
    @CurrentUser() user: any,
  ) {
    return this.feesService.updateStatusTabs(id, body, user);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.ACCOUNTS_MANAGER)
  @Post("custom-fields")
  createFieldDefinition(
    @Body() body: { name: string; dataType: string },
    @CurrentUser() user: any,
  ) {
    return this.feesService.createFieldDefinition(
      body.name,
      body.dataType,
      user.id,
    );
  }

  @Get("custom-fields")
  listFieldDefinitions(
    @Query("appliesTo")
    appliesTo: CustomFieldAppliesTo = CustomFieldAppliesTo.FEE,
  ) {
    return this.feesService.listFieldDefinitions(appliesTo);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.ACCOUNTS_MANAGER)
  @Patch("custom-fields/:id")
  updateFieldDefinition(
    @Param("id") id: string,
    @Body() body: { name?: string; dataType?: string },
  ) {
    return this.feesService.updateFieldDefinition(id, body);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.ACCOUNTS_MANAGER)
  @Delete("custom-fields/:id")
  removeFieldDefinition(@Param("id") id: string) {
    return this.feesService.removeFieldDefinition(id);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.ACCOUNTS_MANAGER, UserRole.STUDENT_AFFAIR)
  @Post("import-excel")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: multer.memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
      fileFilter: (_req, file, callback) => {
        const allowedMimeTypes = [
          "application/vnd.ms-excel",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ];
        if (!allowedMimeTypes.includes(file.mimetype)) {
          return callback(
            new BadRequestException("Only .xls or .xlsx files are allowed"),
            false,
          );
        }
        callback(null, true);
      },
    }),
  )
  importExcel(
    @UploadedFile() file: Express.Multer.File,
    @Body("semesterLabel") semesterLabel: string,
    @CurrentUser() user: any,
  ) {
    if (!file) {
      throw new BadRequestException("No file uploaded");
    }
    return this.feesService.importExcel(file.buffer, semesterLabel, user.id);
  }
}
