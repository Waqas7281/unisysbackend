import {
  BadRequestException,
  Body,
  Controller,
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
import { ScholarshipService } from "./scholarship.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { UserRole } from "../../entities";

const excelUpload = () =>
  FileInterceptor("file", {
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => {
      const allowed = [
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ];
      if (!allowed.includes(file.mimetype)) {
        return callback(
          new BadRequestException("Only .xls or .xlsx files are allowed"),
          false,
        );
      }
      callback(null, true);
    },
  });

// Dekhne wale: Manager, AccountsManager, Registrar, StudentAffair
// Badalne / import / post karne wale: Manager, AccountsManager
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(
  UserRole.MANAGER,
  UserRole.ACCOUNTS_MANAGER,
  UserRole.REGISTRAR,
  UserRole.STUDENT_AFFAIR,
)
@Controller("scholarship")
export class ScholarshipController {
  constructor(private service: ScholarshipService) {}

  @Get("sessions")
  sessions() {
    return this.service.listSessions();
  }

  @Get()
  list(
    @Query("session") session: string,
    @Query("feeColumn") feeColumn?: string,
  ) {
    return this.service.list(session, feeColumn);
  }

  @Roles(UserRole.MANAGER, UserRole.ACCOUNTS_MANAGER)
  @Patch("award/:studentId")
  saveAward(
    @Param("studentId") studentId: string,
    @Body() body: { percent?: any; maintainedCgpa?: any },
    @CurrentUser() user: any,
  ) {
    return this.service.saveAward(studentId, body, user);
  }

  @Roles(UserRole.MANAGER, UserRole.ACCOUNTS_MANAGER)
  @Post("award-bulk")
  saveAwardBulk(
    @Body()
    body: { studentIds: string[]; percent?: any; maintainedCgpa?: any },
    @CurrentUser() user: any,
  ) {
    return this.service.saveAwardBulk(body.studentIds, body, user);
  }

  @Roles(UserRole.MANAGER, UserRole.ACCOUNTS_MANAGER)
  @Patch("cgpa")
  saveCgpa(
    @Body() body: { studentId: string; semesterId: string; cgpa: any },
    @CurrentUser() user: any,
  ) {
    return this.service.saveCgpa(
      body.studentId,
      body.semesterId,
      body.cgpa,
      user,
    );
  }

  @Roles(UserRole.MANAGER, UserRole.ACCOUNTS_MANAGER)
  @Post("import-cgpa")
  @UseInterceptors(excelUpload())
  importCgpa(
    @UploadedFile() file: Express.Multer.File,
    @Body("semesterLabel") semesterLabel: string,
    @CurrentUser() user: any,
  ) {
    if (!file) throw new BadRequestException("No file uploaded");
    return this.service.importCgpa(file.buffer, semesterLabel, user);
  }

  @Roles(UserRole.MANAGER, UserRole.ACCOUNTS_MANAGER)
  @Post("import-awards")
  @UseInterceptors(excelUpload())
  importAwards(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: any,
  ) {
    if (!file) throw new BadRequestException("No file uploaded");
    return this.service.importAwards(file.buffer, user);
  }

  @Roles(UserRole.MANAGER, UserRole.ACCOUNTS_MANAGER)
  @Post("post-drop")
  postDrop(
    @Body() body: { session: string; feeColumn?: string; studentIds: string[] },
    @CurrentUser() user: any,
  ) {
    return this.service.postDrop(
      body.session,
      body.feeColumn,
      body.studentIds,
      user,
    );
  }

  @Roles(UserRole.MANAGER, UserRole.ACCOUNTS_MANAGER)
  @Post("reverse-post")
  reversePost(
    @Body() body: { studentId: string; semesterId: string },
    @CurrentUser() user: any,
  ) {
    return this.service.reversePost(body.studentId, body.semesterId, user);
  }
}
