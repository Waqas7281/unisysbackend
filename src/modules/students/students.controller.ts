import {
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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { StudentsService } from './students.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../entities';

@UseGuards(JwtAuthGuard)
@Controller("students")
export class StudentsController {
  constructor(private studentsService: StudentsService) {}

  @Get()
  findAll(@Query() query: any, @CurrentUser() user: any) {
    const filters: any = {
      search: query.search,
      category: query.category,
      program: query.program,
      missingMatric: query.missingMatric === 'true',
      missingInter: query.missingInter === 'true',
      missingDegreeSession: query.missingDegreeSession === 'true',
    };
    // "mine=true" scopes the list to whatever the current user has personally registered —
    // this is how the Admission Center dashboard only shows its own students.
    if (query.mine === 'true') filters.createdBy = user.id;
    return this.studentsService.findAllFiltered(filters);
  }

  @Get("by-enrollment/:enrollmentNumber")
  findByEnrollment(@Param("enrollmentNumber") enrollmentNumber: string) {
    return this.studentsService.findByEnrollment(enrollmentNumber);
  }

  @Get("custom-fields")
  listFieldDefinitions() {
    return this.studentsService.listFieldDefinitions();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.studentsService.findOne(id);
  }

  @UseGuards(RolesGuard)
  @Roles(
    UserRole.MANAGER,
    UserRole.ACCOUNTS_MANAGER,
    UserRole.ADMISSION_CENTER,
    UserRole.STUDENT_AFFAIR,
  )
  @Post()
  create(@Body() body: any, @CurrentUser() user: any) {
    return this.studentsService.create(body, user);
  }

  @UseGuards(RolesGuard)
  @Roles(
    UserRole.MANAGER,
    UserRole.ACCOUNTS_MANAGER,
    UserRole.STUDENT_AFFAIR,
    UserRole.RECORD_ROOM,
    UserRole.ADMISSION_CENTER,
    UserRole.REGISTRAR,
  )
  @Patch(":id")
  update(@Param("id") id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.studentsService.update(id, body, user);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER)
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.studentsService.remove(id);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.MANAGER, UserRole.ACCOUNTS_MANAGER, UserRole.STUDENT_AFFAIR)
  @Post("import-excel")
  @UseInterceptors(FileInterceptor("file"))
  importExcel(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: any,
  ) {
    return this.studentsService.importExcel(file.buffer, user.id);
  }
}
