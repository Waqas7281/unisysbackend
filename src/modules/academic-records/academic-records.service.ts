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

@Injectable()
export class AcademicRecordsService {
  constructor(
    @InjectRepository(AcademicRecord)
    private recordRepo: EntityRepository<AcademicRecord>,
    @InjectRepository(Student) private studentRepo: EntityRepository<Student>,
    @InjectRepository(User) private userRepo: EntityRepository<User>,
  ) {}

  /** 4-year program => degree session runs startYear..startYear+3, 5-year => startYear..startYear+4. */
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

    // `enteredBy` comes from JWT payload (CurrentUser decorator), so it may not include
    // required entity fields like `passwordHash`. MikroORM validates required properties
    // during persist, so ensure we attach a real managed User entity.
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
    return record;
  }

  async update(
    id: string,
    data: Partial<AcademicRecord> & {
      sessionStartYear?: number;
      sessionEndYear?: number;
    },
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
    return record;
  }

  async remove(id: string) {
    const record = await this.recordRepo.findOneOrFail({ id });
    await this.recordRepo.getEntityManager().removeAndFlush(record);
    return { message: "Record deleted" };
  }

  /** Summary numbers for the Record Room dashboard. */
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
