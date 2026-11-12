import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { EntityRepository } from "@mikro-orm/postgresql";
import { InjectRepository } from "@mikro-orm/nestjs";
import * as XLSX from "xlsx";
import {
  CustomFieldAppliesTo,
  CustomFieldDefinition,
  Fee,
  ScholarshipAward,
  ScholarshipRecord,
  Semester,
  SemesterType,
  Student,
  User,
} from "../../entities";
import { FeesService } from "../fees/fees.service";
import { SemestersService } from "../semesters/semesters.service";
import { AuditService } from "../audit/audit.service";

export type ScholarshipStatus =
  | "Dropped" // current CGPA < maintained CGPA
  | "Eligible" // current CGPA >= maintained CGPA
  | "Pending" // scholarship hai magar CGPA (ya maintained CGPA) abhi nahi aaya
  | "NoScholarship"; // is student ki scholarship nahi

// Fee ke Excel mein "fee after scholarship" ka column dhoondne ki tarteeb.
// (Grand Total sab se aakhir mein, kyun ke us mein fines bhi jud jati hain.)
const FEE_COLUMN_PRIORITY: RegExp[] = [
  /^fee after scholar/i,
  /^fee$/i,
  /^total fee$/i,
  /^net fee$/i,
  /^tuition( fee)?$/i,
  /^grand total$/i,
];

// Fee Excel ke andar agar CGPA ka column ho to (jab file se CGPA na aya ho)
const FEE_CGPA_COLUMN = /^(current\s*)?c?gpa$/i;

// Fee page ka semester number wala column ("Semester", "Semsester", "Sem", "Semester No" ...)
const FEE_SEMESTER_COLUMN =
  /^(current\s*)?sem[a-z]*\.?(\s*(no|number|#)\.?)?$/i;

// Wahi column jahan Applications wala "DropScholarship" amount likhta hai
const DROP_COLUMN = "Drop of scholarship";

// Wo fee jis par scholarship nahi lagti (sab students ke liye)
const FIXED_FEE = 5500;

const num = (v: any): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
};

const cleanEnrollment = (v: any) =>
  String(v ?? "")
    .replace(/[\u00A0\u200B\u200C\u200D\uFEFF]/g, "")
    .trim()
    .replace(/\s+/g, " ");

const normHeader = (h: any) =>
  String(h ?? "")
    .replace(/[\s._\-/]+/g, "")
    .toLowerCase();

@Injectable()
export class ScholarshipService {
  constructor(
    @InjectRepository(ScholarshipAward)
    private awardRepo: EntityRepository<ScholarshipAward>,
    @InjectRepository(ScholarshipRecord)
    private recordRepo: EntityRepository<ScholarshipRecord>,
    @InjectRepository(Fee) private feeRepo: EntityRepository<Fee>,
    @InjectRepository(Semester)
    private semesterRepo: EntityRepository<Semester>,
    @InjectRepository(Student) private studentRepo: EntityRepository<Student>,
    @InjectRepository(CustomFieldDefinition)
    private fieldRepo: EntityRepository<CustomFieldDefinition>,
    private feesService: FeesService,
    private semestersService: SemestersService,
    private auditService: AuditService,
  ) {}

  // ---------------------------------------------------------------- sessions
  // Wo sab sessions jin ki fee Excel import ho chuki hai.
  async listSessions() {
    const em = this.feeRepo.getEntityManager();
    const rows: { label: string; year: number; type: string }[] = await em
      .getConnection()
      .execute(
        `select distinct s.label, s.year, s.type from semesters s inner join fees f on f.semester_id = s.id`,
      );
    return rows
      .sort((a, b) => {
        if (b.year !== a.year) return b.year - a.year;
        const rank = (t: string) => (t === SemesterType.FALL ? 1 : 0);
        return rank(b.type) - rank(a.type);
      })
      .map((r) => r.label);
  }

  // ------------------------------------------------------------- calculation
  private compute(
    percent: number,
    maintained: number | null,
    current: number | null,
    feeAfter: number | null,
  ) {
    let status: ScholarshipStatus;
    if (!percent || percent <= 0) status = "NoScholarship";
    else if (maintained === null || current === null) status = "Pending";
    else status = current + 1e-9 < maintained ? "Dropped" : "Eligible";

    // real fee = fixed + (fee - fixed) / (1 - %/100)
    // (95500, 25%) => 5500 + 90000 / 0.75 = 125500
    let realFee: number | null = null;
    if (feeAfter !== null) {
      if (!percent || percent <= 0) realFee = feeAfter;
      else if (percent < 100) {
        const f = Math.min(FIXED_FEE, feeAfter);
        realFee = Math.round(f + (feeAfter - f) / (1 - percent / 100));
      }
    }

    const dropAmount =
      status === "Dropped" && realFee !== null && feeAfter !== null
        ? realFee - feeAfter
        : 0;
    const feeAfterDrop = status === "Dropped" ? realFee : feeAfter;

    return { status, realFee, dropAmount, feeAfterDrop };
  }

  // ------------------------------------------------------------------- list
  async list(session: string, feeColumn?: string) {
    if (!session || !session.trim()) {
      throw new BadRequestException('Session is required (e.g. "Fall 2026")');
    }
    const label = session.trim();

    const fees = await this.feeRepo.find(
      { semester: { label } },
      { populate: ["student", "semester"] },
    );

    // student -> us semester ki fee rows
    const byStudent = new Map<
      string,
      { student: Student; semester: Semester; imported?: Fee; all: Fee[] }
    >();
    const columns = new Set<string>();
    const allColumns = new Set<string>(); // sab fee rows ke columns (semester dhoondne ke liye)
    for (const fee of fees) {
      let entry = byStudent.get(fee.student.id);
      if (!entry) {
        entry = { student: fee.student, semester: fee.semester, all: [] };
        byStudent.set(fee.student.id, entry);
      }
      entry.all.push(fee);
      Object.keys(fee.customValues || {}).forEach((k) => allColumns.add(k));
      if (fee.feeType === "Imported") {
        entry.imported = fee;
        Object.keys(fee.customValues || {}).forEach((k) => columns.add(k));
      }
    }

    const columnList = Array.from(columns);
    let feeColumnUsed: string | null = null;
    if (feeColumn && columns.has(feeColumn)) {
      feeColumnUsed = feeColumn;
    } else {
      for (const p of FEE_COLUMN_PRIORITY) {
        const hit = columnList.find((c) => p.test(c));
        if (hit) {
          feeColumnUsed = hit;
          break;
        }
      }
    }

    // Fee page ke custom columns ki list + jo values mein maujood hain
    const feeDefs = await this.fieldRepo.find({
      appliesTo: CustomFieldAppliesTo.FEE,
    });
    const semesterCandidates = Array.from(
      new Set([...feeDefs.map((d) => d.name), ...Array.from(allColumns)]),
    );
    const semesterColumnUsed =
      semesterCandidates.find((c) => FEE_SEMESTER_COLUMN.test(c.trim())) ||
      null;

    const ids = Array.from(byStudent.keys());
    const awards = ids.length
      ? await this.awardRepo.find({ student: { $in: ids } })
      : [];
    const awardMap = new Map(awards.map((a) => [a.student.id, a]));
    const records = await this.recordRepo.find({ semester: { label } });
    const recordMap = new Map(records.map((r) => [r.student.id, r]));

    const rows = Array.from(byStudent.values()).map(
      ({ student, semester, imported, all }) => {
        const award = awardMap.get(student.id);
        const record = recordMap.get(student.id);
        const postedAmount = Number(record?.postedAmount) || 0;

        // Sab fee rows: pehle Imported, phir baqi
        const orderedFees = imported
          ? [imported, ...all.filter((x) => x !== imported)]
          : all;

        // --- Fee page se live data (kuch copy nahi hota) ---
        let feeAfter: number | null = null;
        let feeSource: "column" | "amount" | null = null;

        // 1) Excel se aayi row: FEE column (poore semester ki fee)
        if (feeColumnUsed && imported) {
          const v = num(imported.customValues?.[feeColumnUsed]);
          if (v !== null) {
            feeAfter = v;
            feeSource = "column";
          }
        }
        // 2) Haath se add ki hui fee: us semester ki sab tuition rows ka total
        //    (tuition nahi hai to sab rows ka total)
        if (feeAfter === null && all.length) {
          const tuition = all.filter((f) => /tuition/i.test(f.feeType));
          const base = imported ? [imported] : tuition.length ? tuition : all;
          const sum = base.reduce((s, f) => s + (Number(f.amount) || 0), 0);
          if (sum > 0) {
            feeAfter = Math.max(0, sum - postedAmount);
            feeSource = "amount";
          }
        }

        // --- CGPA: pehle file/haath se aya hua, warna Fee page ka CGPA column ---
        let currentCgpa = num(record?.currentCgpa);
        let cgpaSource: "file" | "fee" | null =
          currentCgpa !== null ? "file" : null;
        if (currentCgpa === null) {
          outer: for (const f of orderedFees) {
            for (const [k, val] of Object.entries(f.customValues || {})) {
              if (FEE_CGPA_COLUMN.test(k.trim())) {
                const v = num(val);
                if (v !== null) {
                  currentCgpa = v;
                  cgpaSource = "fee";
                  break outer;
                }
              }
            }
          }
        }

        // --- Semester Fee page ke column se (kisi bhi fee row se; nahi hai to khali) ---
        let semNo: string | null = null;
        if (semesterColumnUsed) {
          for (const f of orderedFees) {
            const sv = f.customValues?.[semesterColumnUsed];
            if (sv !== null && sv !== undefined && String(sv).trim() !== "") {
              semNo = String(sv).trim();
              break;
            }
          }
        }

        const percent = Number(award?.percent) || 0;
        const maintainedCgpa = num(award?.maintainedCgpa);
        const calc = this.compute(
          percent,
          maintainedCgpa,
          currentCgpa,
          feeAfter,
        );

        return {
          studentId: student.id,
          enrollmentNumber: student.enrollmentNumber,
          name: student.name,
          program: student.program || null,
          section: student.section || null,
          semesterId: semester.id,
          session: semester.label,
          semesterNo: semNo,
          feeId: imported?.id || null,
          hasAward: !!award,
          percent,
          maintainedCgpa,
          currentCgpa,
          cgpaSource,
          feeSource,
          feeAfterScholarship: feeAfter,
          realFee: calc.realFee,
          feeAfterDrop: calc.feeAfterDrop,
          dropAmount: calc.dropAmount,
          status: calc.status,
          postedAmount,
          postedAt: record?.postedAt || null,
        };
      },
    );

    rows.sort((a, b) =>
      a.enrollmentNumber.localeCompare(b.enrollmentNumber, undefined, {
        numeric: true,
      }),
    );

    const summary = {
      total: rows.length,
      Dropped: rows.filter((r) => r.status === "Dropped").length,
      Eligible: rows.filter((r) => r.status === "Eligible").length,
      Pending: rows.filter((r) => r.status === "Pending").length,
      NoScholarship: rows.filter((r) => r.status === "NoScholarship").length,
      totalDropAmount: rows.reduce((s, r) => s + r.dropAmount, 0),
      totalPosted: rows.reduce((s, r) => s + r.postedAmount, 0),
    };

    return {
      session: label,
      feeColumnUsed,
      semesterColumnUsed,
      feeColumns: columnList,
      summary,
      rows,
    };
  }

  // ------------------------------------------------------------ award (% + CGPA)
  private parsePercentInput(v: any): number | null | undefined {
    if (v === undefined) return undefined; // touch na karo
    if (v === null || v === "") return null;
    const n = num(String(v).replace("%", ""));
    if (n === null || n < 0 || n > 100) {
      throw new BadRequestException("Scholarship % must be between 0 and 100");
    }
    return n;
  }

  private parseCgpaInput(v: any): number | null | undefined {
    if (v === undefined) return undefined;
    if (v === null || v === "") return null;
    const n = num(v);
    if (n === null || n < 0 || n > 10) {
      throw new BadRequestException("CGPA must be a number between 0 and 10");
    }
    return n;
  }

  private async upsertAward(
    student: Student,
    data: { percent?: any; maintainedCgpa?: any },
    user: { id: string; role: string },
  ) {
    const percent = this.parsePercentInput(data.percent);
    const maintained = this.parseCgpaInput(data.maintainedCgpa);
    const em = this.awardRepo.getEntityManager();

    let award = await this.awardRepo.findOne({ student });
    const changes: Record<string, { from: any; to: any }> = {};
    if (!award) {
      award = this.awardRepo.create({ student } as any);
      em.persist(award);
    }
    if (percent !== undefined && Number(award.percent) !== (percent ?? 0)) {
      changes.percent = { from: Number(award.percent), to: percent ?? 0 };
      award.percent = String(percent ?? 0);
    }
    if (maintained !== undefined) {
      const before = num(award.maintainedCgpa);
      if (before !== maintained) {
        changes.maintainedCgpa = { from: before, to: maintained };
        award.maintainedCgpa =
          maintained === null ? undefined : String(maintained);
      }
    }
    award.updatedBy = em.getReference(User, user.id) as any;
    return { award, changes };
  }

  async saveAward(
    studentId: string,
    data: { percent?: any; maintainedCgpa?: any },
    user: { id: string; role: string },
  ) {
    const student = await this.studentRepo.findOne({ id: studentId });
    if (!student) throw new NotFoundException("Student not found");
    const { award, changes } = await this.upsertAward(student, data, user);
    await this.awardRepo.getEntityManager().flush();
    if (Object.keys(changes).length) {
      await this.auditService.log({
        module: "Scholarship",
        action: "Updated",
        studentId: student.id,
        recordId: award.id,
        actingUser: user,
        description: `Scholarship terms updated for ${student.name} (${student.enrollmentNumber})`,
        changes,
      });
    }
    return award;
  }

  // Selected bachon ko ek hi % / maintained CGPA lagana
  async saveAwardBulk(
    studentIds: string[],
    data: { percent?: any; maintainedCgpa?: any },
    user: { id: string; role: string },
  ) {
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      throw new BadRequestException("No students selected");
    }
    const students = await this.studentRepo.find({ id: { $in: studentIds } });
    for (const s of students) await this.upsertAward(s, data, user);
    await this.awardRepo.getEntityManager().flush();
    await this.auditService.log({
      module: "Scholarship",
      action: "BulkUpdated",
      actingUser: user,
      description: `Scholarship terms set for ${students.length} students (percent: ${data.percent ?? "—"}, maintained CGPA: ${data.maintainedCgpa ?? "—"})`,
    });
    return { updated: students.length };
  }

  // ------------------------------------------------------------ current CGPA
  async saveCgpa(
    studentId: string,
    semesterId: string,
    cgpa: any,
    user: { id: string; role: string },
  ) {
    const value = this.parseCgpaInput(cgpa);
    const student = await this.studentRepo.findOne({ id: studentId });
    if (!student) throw new NotFoundException("Student not found");
    const semester = await this.semesterRepo.findOne({
      id: semesterId,
      student,
    });
    if (!semester) throw new NotFoundException("Semester not found");

    const em = this.recordRepo.getEntityManager();
    let record = await this.recordRepo.findOne({ student, semester });
    const before = num(record?.currentCgpa);
    if (!record) {
      record = this.recordRepo.create({ student, semester } as any);
      em.persist(record);
    }
    record.currentCgpa =
      value === null || value === undefined ? undefined : String(value);
    await em.flush();
    await this.auditService.log({
      module: "Scholarship",
      action: "CgpaUpdated",
      studentId: student.id,
      recordId: record.id,
      actingUser: user,
      description: `CGPA for ${semester.label} set for ${student.name} (${student.enrollmentNumber})`,
      changes: { currentCgpa: { from: before, to: value ?? null } },
    });
    return record;
  }

  // ----------------------------------------------------------- excel helpers
  private readSheet(buffer: Buffer) {
    const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const grid: any[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
      raw: true,
    });
    let headerRowIdx = -1;
    for (let r = 0; r < Math.min(grid.length, 15); r++) {
      const row = grid[r] || [];
      if (
        row.some((c) => typeof c === "string" && /roll|enrollment/i.test(c))
      ) {
        headerRowIdx = r;
        break;
      }
    }
    if (headerRowIdx === -1) {
      throw new BadRequestException(
        "Could not find a header row containing an Enrollment/Roll Number column",
      );
    }
    const headers: any[] = grid[headerRowIdx];
    const enrollCol = headers.findIndex(
      (h) => typeof h === "string" && /roll|enrollment/i.test(h),
    );
    return { grid, headers, headerRowIdx, enrollCol };
  }

  // GPA file: Enrollment | GPA/CGPA | Semester
  async importCgpa(
    buffer: Buffer,
    defaultSemesterLabel: string | undefined,
    user: { id: string; role: string },
  ) {
    const { grid, headers, headerRowIdx, enrollCol } = this.readSheet(buffer);
    const cgpaCol = headers.findIndex(
      (h) => h && /^(current)?c?gpa$/.test(normHeader(h)),
    );
    const semCol = headers.findIndex(
      (h) => h && /^(semester|session|term)$/.test(normHeader(h)),
    );
    if (cgpaCol === -1) {
      throw new BadRequestException('Could not find a "GPA" or "CGPA" column');
    }
    if (semCol === -1 && !defaultSemesterLabel?.trim()) {
      throw new BadRequestException(
        'File mein "Semester" column nahi hai — upar Session select karke dobara import karein',
      );
    }

    const em = this.recordRepo.getEntityManager();
    const cache = new Map<string, ScholarshipRecord>();
    const skipped: { row: number; enrollment: string; reason: string }[] = [];
    let created = 0;
    let updated = 0;

    for (let r = headerRowIdx + 1; r < grid.length; r++) {
      const row = grid[r];
      if (!row || row.every((c) => c === null || c === undefined || c === ""))
        continue;
      const enrollment = cleanEnrollment(row[enrollCol]);
      if (!enrollment) continue;
      const rowNo = r + 1;

      const cgpa = num(row[cgpaCol]);
      if (cgpa === null || cgpa < 0 || cgpa > 10) {
        skipped.push({
          row: rowNo,
          enrollment,
          reason: "Invalid or empty GPA",
        });
        continue;
      }

      const semRaw = semCol >= 0 ? row[semCol] : defaultSemesterLabel;
      const semCell =
        semRaw === null || semRaw === undefined || semRaw === ""
          ? defaultSemesterLabel
          : semRaw;
      const parsed = this.semestersService.parseSessionLabel(semCell);
      // Agar semester column mein sirf number hai (1, 2, 3 ...) to wo semester number samjha jayega
      const semNo =
        !parsed &&
        semCell !== undefined &&
        /^\d{1,2}$/.test(String(semCell).trim())
          ? Number(String(semCell).trim())
          : null;
      if (!parsed && semNo === null) {
        skipped.push({
          row: rowNo,
          enrollment,
          reason: `Semester "${semCell ?? ""}" samajh nahi aya (e.g. Fall 2026 ya 3)`,
        });
        continue;
      }

      const student = await this.studentRepo.findOne({
        enrollmentNumber: { $ilike: enrollment },
      });
      if (!student) {
        skipped.push({ row: rowNo, enrollment, reason: "Student not found" });
        continue;
      }
      const semester = parsed
        ? await this.semesterRepo.findOne({
            student,
            type: parsed.type,
            year: parsed.year,
          })
        : await this.semesterRepo.findOne({ student, order: semNo as number });
      if (!semester) {
        skipped.push({
          row: rowNo,
          enrollment,
          reason: parsed
            ? `${parsed.type} ${parsed.year} is student ki semester list mein nahi hai`
            : `Semester ${semNo} is student ki list mein nahi hai`,
        });
        continue;
      }

      const key = `${student.id}|${semester.id}`;
      let record =
        cache.get(key) ||
        (await this.recordRepo.findOne({ student, semester }));
      if (!record) {
        record = this.recordRepo.create({ student, semester } as any);
        em.persist(record);
        created++;
      } else if (!cache.has(key)) {
        updated++;
      }
      record.currentCgpa = String(cgpa);
      cache.set(key, record);
    }

    await em.flush();
    await this.auditService.log({
      module: "Scholarship",
      action: "CgpaImported",
      actingUser: user,
      description: `CGPA Excel imported: ${created} new, ${updated} updated, ${skipped.length} skipped`,
    });

    return { created, updated, skippedCount: skipped.length, skipped };
  }

  // Scholarship file: Enrollment | Scholarship % | Maintained CGPA
  async importAwards(buffer: Buffer, user: { id: string; role: string }) {
    const { grid, headers, headerRowIdx, enrollCol } = this.readSheet(buffer);
    const maintCol = headers.findIndex(
      (h) =>
        h && /maintain|accept|requir|minimum|min.?c?gpa|c?gpa/i.test(String(h)),
    );
    const percentCol = headers.findIndex(
      (h, i) =>
        i !== maintCol && h && /scholar|percent|%|disc/i.test(String(h)),
    );
    if (percentCol === -1 && maintCol === -1) {
      throw new BadRequestException(
        'Columns "Scholarship %" aur/ya "Maintained CGPA" nahi mile',
      );
    }

    const skipped: { row: number; enrollment: string; reason: string }[] = [];
    let updated = 0;

    for (let r = headerRowIdx + 1; r < grid.length; r++) {
      const row = grid[r];
      if (!row || row.every((c) => c === null || c === undefined || c === ""))
        continue;
      const enrollment = cleanEnrollment(row[enrollCol]);
      if (!enrollment) continue;
      const student = await this.studentRepo.findOne({
        enrollmentNumber: { $ilike: enrollment },
      });
      if (!student) {
        skipped.push({ row: r + 1, enrollment, reason: "Student not found" });
        continue;
      }

      const data: { percent?: any; maintainedCgpa?: any } = {};
      if (
        percentCol >= 0 &&
        row[percentCol] !== null &&
        row[percentCol] !== ""
      ) {
        let p = row[percentCol];
        if (typeof p === "number" && p > 0 && p <= 1) p = p * 100; // 0.2 => 20%
        data.percent = String(p).replace("%", "");
      }
      if (maintCol >= 0 && row[maintCol] !== null && row[maintCol] !== "") {
        data.maintainedCgpa = row[maintCol];
      }
      if (data.percent === undefined && data.maintainedCgpa === undefined)
        continue;

      try {
        await this.upsertAward(student, data, user);
        updated++;
      } catch (e: any) {
        skipped.push({
          row: r + 1,
          enrollment,
          reason: e?.message || "Invalid data",
        });
      }
    }

    await this.awardRepo.getEntityManager().flush();
    await this.auditService.log({
      module: "Scholarship",
      action: "AwardsImported",
      actingUser: user,
      description: `Scholarship Excel imported: ${updated} students updated, ${skipped.length} skipped`,
    });
    return { updated, skippedCount: skipped.length, skipped };
  }

  // ------------------------------------------------- Fee page se link (post)
  // "Drop of scholarship" column Fee page par dikhne ke liye uski definition honi chahiye
  private async ensureDropColumnDefinition(userId: string) {
    const existing = await this.fieldRepo.find({
      appliesTo: CustomFieldAppliesTo.FEE,
    });
    if (
      existing.some((d) => d.name.toLowerCase() === DROP_COLUMN.toLowerCase())
    )
      return;
    const max = existing.reduce((m, d) => Math.max(m, d.columnOrder || 0), 0);
    const def = this.fieldRepo.create({
      name: DROP_COLUMN,
      appliesTo: CustomFieldAppliesTo.FEE,
      dataType: "number",
      columnOrder: max + 1,
      createdByUserId: userId,
    });
    await this.fieldRepo.getEntityManager().persistAndFlush(def);
  }

  async postDrop(
    session: string,
    feeColumn: string | undefined,
    studentIds: string[],
    user: { id: string; role: string },
  ) {
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      throw new BadRequestException("No students selected");
    }
    // Amount hamesha server par dobara hisab se nikalta hai (client par bharosa nahi)
    const { rows } = await this.list(session, feeColumn);
    const wanted = new Set(studentIds);
    const em = this.recordRepo.getEntityManager();

    await this.ensureDropColumnDefinition(user.id);

    const posted: { enrollment: string; amount: number }[] = [];
    const skipped: { enrollment: string; reason: string }[] = [];

    for (const r of rows.filter((x) => wanted.has(x.studentId))) {
      if (r.status !== "Dropped") {
        skipped.push({
          enrollment: r.enrollmentNumber,
          reason: "Drop nahi hua",
        });
        continue;
      }
      if (r.postedAmount > 0) {
        skipped.push({
          enrollment: r.enrollmentNumber,
          reason: "Pehle se post ho chuka hai",
        });
        continue;
      }
      if (!(r.dropAmount > 0)) {
        skipped.push({
          enrollment: r.enrollmentNumber,
          reason: "Fee ya farq nikal nahi saka (fee column check karein)",
        });
        continue;
      }

      const fee = await this.feesService.postApplicationFine(
        r.studentId,
        r.semesterId,
        "DropScholarship",
        r.dropAmount,
        `Scholarship dropped (CGPA ${r.currentCgpa} < ${r.maintainedCgpa})`,
        user,
      );
      (fee as any).dropOfScholarship = true;

      let record = await this.recordRepo.findOne({
        student: r.studentId,
        semester: r.semesterId,
      });
      if (!record) {
        record = this.recordRepo.create({
          student: em.getReference(Student, r.studentId),
          semester: em.getReference(Semester, r.semesterId),
        } as any);
        em.persist(record);
      }
      record.postedAmount = String(r.dropAmount);
      record.postedAt = new Date();
      record.postedBy = em.getReference(User, user.id) as any;
      await em.flush();

      await this.auditService.log({
        module: "Scholarship",
        action: "DropPosted",
        studentId: r.studentId,
        recordId: record.id,
        actingUser: user,
        description: `Drop of scholarship Rs ${r.dropAmount.toLocaleString()} posted for ${r.name} (${r.enrollmentNumber}) — ${r.session}`,
      });
      posted.push({ enrollment: r.enrollmentNumber, amount: r.dropAmount });
    }
    return { postedCount: posted.length, posted, skipped };
  }

  async reversePost(
    studentId: string,
    semesterId: string,
    user: { id: string; role: string },
  ) {
    const record = await this.recordRepo.findOne(
      { student: studentId, semester: semesterId },
      { populate: ["student", "semester"] },
    );
    const amount = Number(record?.postedAmount) || 0;
    if (!record || amount <= 0) {
      throw new BadRequestException("Is student ka koi posted drop nahi hai");
    }

    const fee =
      (await this.feeRepo.findOne({
        student: studentId,
        semester: semesterId,
        feeType: "Imported",
      })) ||
      (await this.feeRepo.findOne({
        student: studentId,
        semester: semesterId,
      }));
    if (!fee) throw new NotFoundException("Fee row not found");

    const current = Number(fee.customValues?.[DROP_COLUMN]) || 0;
    const next = Math.max(0, current - amount);
    fee.customValues = { ...(fee.customValues || {}), [DROP_COLUMN]: next };
    fee.amount = String(Math.max(0, Number(fee.amount || 0) - amount));
    if (next === 0) fee.dropOfScholarship = false;

    record.postedAmount = "0";
    (record as any).postedAt = null;
    (record as any).postedBy = null;
    await this.recordRepo.getEntityManager().flush();

    await this.auditService.log({
      module: "Scholarship",
      action: "DropReversed",
      studentId,
      recordId: record.id,
      actingUser: user,
      description: `Drop of scholarship Rs ${amount.toLocaleString()} reversed for ${record.student.name} (${record.student.enrollmentNumber}) — ${record.semester.label}`,
    });
    return { reversed: amount };
  }
}
