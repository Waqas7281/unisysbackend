import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { EntityRepository } from "@mikro-orm/postgresql";
import { InjectRepository } from "@mikro-orm/nestjs";
import { SemestersService } from "./semesters.service";
import { SemesterType, Student } from "../../entities";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";

@UseGuards(JwtAuthGuard)
@Controller("semesters")
export class SemestersController {
  constructor(
    private semestersService: SemestersService,
    @InjectRepository(Student) private studentRepo: EntityRepository<Student>,
  ) {}

  @Get("student/:studentId")
  findForStudent(@Param("studentId") studentId: string) {
    return this.semestersService.findForStudent(studentId);
  }

  @Post("student/:studentId/generate")
  async generate(
    @Param("studentId") studentId: string,
    @Body() body: { startYear: number; startType?: string },
  ) {
    const student = await this.studentRepo.findOneOrFail({ id: studentId });
    // Accepts "Fall"/"Spring" (any casing) from the client — e.g. derived from the
    // student's own "Adm Session" Excel value — and falls back to Fall for
    // anything unrecognized, matching the previous default behavior.
    const startType =
      typeof body.startType === "string" &&
      body.startType.trim().toLowerCase() === "spring"
        ? SemesterType.SPRING
        : SemesterType.FALL;
    return this.semestersService.generateRoadmap(
      student,
      body.startYear,
      startType,
    );
  }

  @Post("student/:studentId/extend")
  async extend(@Param("studentId") studentId: string) {
    const student = await this.studentRepo.findOneOrFail({ id: studentId });
    return this.semestersService.extendRollingWindow(student);
  }
}
