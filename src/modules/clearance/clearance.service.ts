import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { EntityRepository } from "@mikro-orm/postgresql";
import { InjectRepository } from "@mikro-orm/nestjs";
import { randomBytes } from "crypto";
import { ClearanceSlip, Student, User } from "../../entities";
import { FeesService } from "../fees/fees.service";

const SLIP_VALID_DAYS = 10;

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, server-local UTC day
}

@Injectable()
export class ClearanceService {
  constructor(
    @InjectRepository(ClearanceSlip)
    private slipRepo: EntityRepository<ClearanceSlip>,
    @InjectRepository(Student)
    private studentRepo: EntityRepository<Student>,
    private feesService: FeesService,
  ) {}

  /**
   * Deletes every expired slip. Called opportunistically on both generate and
   * verify so the table self-cleans without needing a separate always-running
   * cron process — this keeps it working identically whether the backend runs
   * on PM2 (long-running) or as a Vercel serverless function (no persistent
   * background process).
   */
  private async cleanupExpired() {
    const em = this.slipRepo.getEntityManager();
    await em.nativeDelete(ClearanceSlip, { expiresAt: { $lt: new Date() } });
  }

  /**
   * Search a student by enrollment number and return their full fee summary
   * (every semester, paid/unpaid/fine totals) — what the Accounts Manager
   * reviews before deciding to generate a clearance slip.
   */
  async searchStudent(enrollmentNumber: string) {
    const value = (enrollmentNumber || "").trim();
    if (!value) throw new BadRequestException("Enrollment number required");

    const student = await this.studentRepo.findOne({
      enrollmentNumber: { $ilike: value },
    });
    if (!student) throw new NotFoundException("Student not found");

    const feeSummary = await this.feesService.findForStudent(student.id);

    let totalPaid = 0;
    for (const bucket of feeSummary.semesters) {
      for (const fee of bucket.fees) {
        totalPaid += Number(fee.paidAmount) || 0;
      }
    }
    const totalUnpaid = feeSummary.grandTotal - totalPaid;

    return {
      student,
      semesters: feeSummary.semesters,
      totalFee: feeSummary.grandTotal,
      totalPaid,
      totalUnpaid,
      totalFine: feeSummary.grandFineTotal,
    };
  }

  async generateSlip(
    studentId: string,
    term: string,
    backgroundColor: string | undefined,
    issuedByUserId: string | undefined,
  ) {
    await this.cleanupExpired();

    const student = await this.studentRepo.findOneOrFail({ id: studentId });
    const em = this.slipRepo.getEntityManager();
    const issuedBy = issuedByUserId
      ? em.getReference(User, issuedByUserId)
      : undefined;

    // 32 random bytes -> a long, unguessable base64url token. This is the
    // "unique phrase" — it identifies the slip, not the student's roll number,
    // so nobody can hand-write a fake one that happens to verify successfully.
    const token = randomBytes(32).toString("base64url");

    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt);
    expiresAt.setDate(expiresAt.getDate() + SLIP_VALID_DAYS);

    const slip = this.slipRepo.create({
      student,
      token,
      term: term?.trim() || "Clearance Slip",
      backgroundColor: backgroundColor || undefined,
      issuedBy,
      issuedAt,
      expiresAt,
    });

    await em.persistAndFlush(slip);

    return {
      id: slip.id,
      token: slip.token,
      term: slip.term,
      backgroundColor: slip.backgroundColor,
      issuedAt: slip.issuedAt,
      expiresAt: slip.expiresAt,
      student: {
        name: student.name,
        rollNumber: student.rollNo || student.enrollmentNumber,
        department: student.program,
      },
    };
  }

  /**
   * Verifies a scanned token. Returns one of:
   *  - { valid: false, reason: 'not_found' | 'expired' }
   *  - { valid: true, alreadyScanned: true, rollNumber, name }   (2nd+ scan today)
   *  - { valid: true, alreadyScanned: false, rollNumber, name }  (first scan today)
   */
  async verifyToken(token: string) {
    await this.cleanupExpired();

    const clean = (token || "").trim();
    if (!clean) return { valid: false, reason: "not_found" as const };

    const slip = await this.slipRepo.findOne(
      { token: clean },
      { populate: ["student"] },
    );
    if (!slip) return { valid: false, reason: "not_found" as const };

    if (slip.expiresAt.getTime() < Date.now()) {
      return { valid: false, reason: "expired" as const };
    }

    const today = todayDateString();

    if (slip.lastScannedDate === today) {
      return {
        valid: true,
        alreadyScanned: true,
        rollNumber: slip.student.rollNo || slip.student.enrollmentNumber,
        name: slip.student.name,
        term: slip.term,
      };
    }

    slip.lastScannedDate = today;
    slip.scanCount += 1;
    await this.slipRepo.getEntityManager().persistAndFlush(slip);

    return {
      valid: true,
      alreadyScanned: false,
      rollNumber: slip.student.rollNo || slip.student.enrollmentNumber,
      name: slip.student.name,
      department: slip.student.program,
      term: slip.term,
    };
  }
}
