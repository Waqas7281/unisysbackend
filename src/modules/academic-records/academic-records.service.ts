import { Injectable, NotFoundException } from "@nestjs/common";
import { EntityRepository } from "@mikro-orm/postgresql";
import { InjectRepository } from "@mikro-orm/nestjs";
import {
  AcademicLevel,
  AcademicLevelValues,
  AcademicRecord,
  SemesterSystem,
  Student,
  StudentCategory,
  User,
} from "../../entities";
import { AuditService } from "../audit/audit.service";

@Injectable()
export class AcademicRecordsService {
  constructor(
    @InjectRepository(AcademicRecord)
    private recordRepo: EntityRepository<AcademicRecord>,
    @InjectRepository(Student) private studentRepo: EntityRepository<Student>,
    @InjectRepository(User) private userRepo: EntityRepository<User>,
    private auditService: AuditService,
  ) {}

  private programYears(student: Student): number {
    return student.semesterSystem === SemesterSystem.FOUR_YEAR ? 4 : 5;
  }

  private resolveSessionEndYear(
    student: Student,
    level: AcademicLevel,
    sessionStartYear?: number,
    explicitEndYear?: number,
  ): number | undefined {
    if (explicitEndYear) return explicitEndYear;
    if (level === AcademicLevelValues.DEGREE && sessionStartYear) {
      return sessionStartYear + this.programYears(student) - 1;
    }
    return undefined;
  }

  findByEnrollment(enrollmentNumber: string) {
    const value = (enrollmentNumber || "").trim();
    return this.recordRepo.find(
      { student: { enrollmentNumber: { $ilike: value } } },
      { populate: ["student", "enteredBy"], orderBy: { createdAt: "DESC" } },
    );
  }

  findByStudentId(studentId: string) {
    return this.recordRepo.find(
      { student: { id: studentId } },
      { populate: ["enteredBy"], orderBy: { createdAt: "DESC" } },
    );
  }

  async create(data: any, enteredBy: User) {
    let student: Student | null = null;

    const enteredById = (enteredBy as any)?.id;
    const enteredByEntity = enteredById
      ? await this.userRepo.findOne({ id: enteredById })
      : undefined;

    if (data.studentId) {
      student = await this.studentRepo.findOne({ id: data.studentId });
    } else if (data.enrollmentNumber) {
      student = await this.studentRepo.findOne({
        enrollmentNumber: { $ilike: String(data.enrollmentNumber).trim() },
      });
    }
    if (!student) throw new NotFoundException("Student not found");

    const sessionStartYear = data.sessionStartYear
      ? Number(data.sessionStartYear)
      : undefined;
    const sessionEndYear = this.resolveSessionEndYear(
      student,
      data.level,
      sessionStartYear,
      data.sessionEndYear ? Number(data.sessionEndYear) : undefined,
    );

    const record = this.recordRepo.create({
      student,
      level: data.level,
      sessionStartYear,
      sessionEndYear,
      totalMarks:
        data.totalMarks !== undefined && data.totalMarks !== ""
          ? Number(data.totalMarks)
          : undefined,
      obtainedMarks:
        data.obtainedMarks !== undefined && data.obtainedMarks !== ""
          ? Number(data.obtainedMarks)
          : undefined,
      enteredBy: enteredByEntity ?? undefined,
    });

    await this.recordRepo.getEntityManager().persistAndFlush(record);
    if (enteredById) {
      await this.auditService.log({
        module: "AcademicRecord",
        action: "Created",
        studentId: student.id,
        recordId: record.id,
        actingUser: { id: enteredById, role: (enteredBy as any)?.role },
        description: `Added ${data.level} academic record for ${student.name} (${student.enrollmentNumber})`,
      });
    }
    return record;
  }

  async update(
    id: string,
    data: Partial<AcademicRecord> & {
      sessionStartYear?: number;
      sessionEndYear?: number;
    },
    actingUser?: any,
  ) {
    const record = await this.recordRepo.findOne(
      { id },
      { populate: ["student"] },
    );
    if (!record) throw new NotFoundException("Record not found");

    const nextStartYear =
      data.sessionStartYear !== undefined
        ? Number(data.sessionStartYear)
        : record.sessionStartYear;
    const explicitEndYear =
      data.sessionEndYear !== undefined
        ? Number(data.sessionEndYear)
        : undefined;

    const trackedFields: (keyof AcademicRecord)[] = [
      "totalMarks",
      "obtainedMarks",
      "sessionStartYear",
      "sessionEndYear",
    ];
    const changes: Record<string, { from: any; to: any }> = {};
    for (const field of trackedFields) {
      if (
        Object.prototype.hasOwnProperty.call(data, field) &&
        String((data as any)[field]) !== String((record as any)[field])
      ) {
        changes[field] = {
          from: (record as any)[field],
          to: (data as any)[field],
        };
      }
    }

    Object.assign(record, data);

    if (record.level === AcademicLevelValues.DEGREE) {
      record.sessionEndYear = this.resolveSessionEndYear(
        record.student,
        record.level,
        nextStartYear,
        explicitEndYear,
      );
    }

    await this.recordRepo.getEntityManager().flush();

    if (actingUser?.id && Object.keys(changes).length) {
      const changeSummary = Object.entries(changes)
        .map(
          ([field, { from, to }]) => `${field}: ${from ?? "—"} → ${to ?? "—"}`,
        )
        .join(", ");
      await this.auditService.log({
        module: "AcademicRecord",
        action: "Updated",
        studentId: record.student.id,
        recordId: record.id,
        actingUser,
        description: `Updated ${record.level} record for ${record.student.name} (${record.student.enrollmentNumber}) — ${changeSummary}`,
        changes,
      });
    }
    return record;
  }

  async remove(id: string, actingUser?: any) {
    const record = await this.recordRepo.findOneOrFail(
      { id },
      { populate: ["student"] },
    );
    const summary = `${record.level} record for ${record.student.name} (${record.student.enrollmentNumber})`;
    await this.recordRepo.getEntityManager().removeAndFlush(record);
    if (actingUser?.id) {
      await this.auditService.log({
        module: "AcademicRecord",
        action: "Deleted",
        recordId: id,
        actingUser,
        description: `Deleted ${summary}`,
      });
    }
    return { message: "Record deleted" };
  }

  async dashboardSummary() {
    const conn = this.recordRepo.getEntityManager().getConnection();
    const totalStudents = await this.studentRepo.count();
    const newAdmissions = await this.studentRepo.count({
      studentCategory: StudentCategory.NEW_ADMISSION,
    });
    const continuing = totalStudents - newAdmissions;

    const missingMatric = await conn.execute(
      `SELECT COUNT(*)::int AS count FROM students s WHERE NOT EXISTS (SELECT 1 FROM academic_records ar WHERE ar.student_id = s.id AND ar.level = 'Matric')`,
    );
    const missingInter = await conn.execute(
      `SELECT COUNT(*)::int AS count FROM students s WHERE NOT EXISTS (SELECT 1 FROM academic_records ar WHERE ar.student_id = s.id AND ar.level = 'Intermediate')`,
    );
    const missingDegree = await conn.execute(
      `SELECT COUNT(*)::int AS count FROM students s WHERE NOT EXISTS (SELECT 1 FROM academic_records ar WHERE ar.student_id = s.id AND ar.level = 'Degree')`,
    );

    return {
      totalStudents,
      newAdmissions,
      continuing,
      missingMatricResult: missingMatric[0]?.count ?? 0,
      missingInterResult: missingInter[0]?.count ?? 0,
      missingDegreeSession: missingDegree[0]?.count ?? 0,
    };
  }
}
