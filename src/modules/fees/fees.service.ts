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
  Semester,
  SemesterType,
  Student,
} from "../../entities";
import { NotificationsService } from "../notifications/notifications.service";
import { SemestersService } from "../semesters/semesters.service";
import { AuditService } from "../audit/audit.service";

// Columns in a fee Excel sheet that identify the student / row context rather than
// representing an actual fee amount/column. These are matched against, never turned
// into dynamic fee columns.
const IDENTITY_COLUMN_PATTERNS: RegExp[] = [
  /^sr\.?\s*#?$/i,
  /^roll\s*#?$/i,
  /^roll\s*no\.?$/i,
  /^enrollment\s*(number|no\.?)?$/i,
  /^name$/i,
  /^student\s*name$/i,
  /^pregame$/i, // common typo for "Program" seen in real sheets
  /^program$/i,
  /^section$/i,
];

// Known dedicated fine columns that application actions (UMC/DC, DPT, Bar, DropScholarship)
// post into on the Imported fee row — plus any feeType that represents a standalone fine row.
const FINE_COLUMN_NAMES = [
  "UMC/DC",
  "DPT",
  "Bar Council",
  "Drop of scholarship",
  "Fine",
  "Late Fee",
  "LateFee",
];

function isFineFeeType(feeType: string): boolean {
  if (!feeType) return false;
  const t = feeType.toLowerCase();
  return (
    t.startsWith("fine:") ||
    t === "fine" ||
    t === "latefee" ||
    t === "umc" ||
    t === "dc" ||
    t === "dpt" ||
    t === "bar" ||
    t === "dropscholarship" ||
    t === "cancel"
  );
}

// Sum of everything on a fee row that represents a fine/penalty rather than a regular
// tuition/registration charge — combines dedicated fine feeType rows with fine-related
// custom columns (UMC/DC, DPT, Bar Council, Drop of scholarship, etc.) on Imported rows.
function fineAmountForFee(fee: Fee): number {
  let amount = 0;
  if (isFineFeeType(fee.feeType)) {
    amount += Number(fee.amount) || 0;
  }
  if (fee.customValues) {
    for (const [key, value] of Object.entries(fee.customValues)) {
      const matches = FINE_COLUMN_NAMES.some(
        (n) => n.toLowerCase() === key.toLowerCase(),
      );
      if (matches) amount += Number(value) || 0;
    }
  }
  return amount;
}

@Injectable()
export class FeesService {
  constructor(
    @InjectRepository(Fee) private feeRepo: EntityRepository<Fee>,
    @InjectRepository(Semester)
    private semesterRepo: EntityRepository<Semester>,
    @InjectRepository(Student) private studentRepo: EntityRepository<Student>,
    @InjectRepository(CustomFieldDefinition)
    private fieldRepo: EntityRepository<CustomFieldDefinition>,
    private notifications: NotificationsService,
    private semestersService: SemestersService,
    private auditService: AuditService,
  ) {}

  async findForStudent(studentId: string) {
    const fees = await this.feeRepo.find(
      { student: studentId },
      { orderBy: { semester: { order: "ASC" } }, populate: ["semester"] },
    );
    const semesterMap = new Map<string, any>();
    for (const fee of fees) {
      const semId = fee.semester.id;
      if (!semesterMap.has(semId)) {
        semesterMap.set(semId, {
          semester: fee.semester,
          fees: [],
          semesterTotal: 0,
          semesterFineTotal: 0,
        });
      }
      const bucket = semesterMap.get(semId);
      bucket.fees.push(fee);
      bucket.semesterTotal += Number(fee.amount);
      bucket.semesterFineTotal += fineAmountForFee(fee);
    }
    const semesters = Array.from(semesterMap.values());
    const grandTotal = semesters.reduce((sum, s) => sum + s.semesterTotal, 0);
    // Grand fine total across every semester (Fall + Spring combined) for this student.
    const grandFineTotal = semesters.reduce(
      (sum, s) => sum + s.semesterFineTotal,
      0,
    );
    return { semesters, grandTotal, grandFineTotal };
  }

  async addFee(
    data: {
      studentId: string;
      semesterId: string;
      feeType: string;
      amount: number;
      installmentNumber?: number;
      dueDate?: Date;
      customValues?: Record<string, any>;
    },
    actingUser: { id: string; role: string },
  ) {
    const student = await this.studentRepo.findOneOrFail({
      id: data.studentId,
    });
    const semester = await this.semesterRepo.findOneOrFail({
      id: data.semesterId,
    });
    const fee = this.feeRepo.create({
      student,
      semester,
      feeType: data.feeType,
      amount: String(data.amount),
      installmentNumber: data.installmentNumber || 1,
      dueDate: data.dueDate,
      customValues: data.customValues || {},
    });
    await this.feeRepo.getEntityManager().persistAndFlush(fee);
    await this.notifications.notifyRoles(
      ["Manager"],
      "FeeUpdated",
      `Fee added for ${student.name} (${student.enrollmentNumber})`,
      "Student",
      student.id,
    );
    await this.auditService.log({
      module: "Fee",
      action: "Created",
      studentId: student.id,
      recordId: fee.id,
      actingUser,
      description: `Added a "${data.feeType}" fee of Rs ${Number(data.amount).toLocaleString()} for ${student.name} (${student.enrollmentNumber}), ${semester.label}`,
    });
    return fee;
  }

  async updateFee(
    id: string,
    data: Partial<Fee>,
    actingUser: { id: string; role: string },
  ) {
    const fee = await this.feeRepo.findOne({ id }, { populate: ["student"] });
    if (!fee) throw new NotFoundException("Fee record not found");

    const trackedFields: (keyof Fee)[] = [
      "amount",
      "paidStatus",
      "paidAmount",
      "feeType",
      "dueDate",
      "installmentNumber",
    ];
    const changes: Record<string, { from: any; to: any }> = {};
    for (const field of trackedFields) {
      if (
        Object.prototype.hasOwnProperty.call(data, field) &&
        String((data as any)[field]) !== String((fee as any)[field])
      ) {
        changes[field] = {
          from: (fee as any)[field],
          to: (data as any)[field],
        };
      }
    }

    if (data.customValues) {
      data = {
        ...data,
        customValues: { ...(fee.customValues || {}), ...data.customValues },
      };
    }
    Object.assign(fee, data);
    await this.feeRepo.getEntityManager().flush();
    await this.notifications.notifyRoles(
      ["Manager"],
      "FeeUpdated",
      `Fee updated for ${fee.student.name} (${fee.student.enrollmentNumber})`,
      "Student",
      fee.student.id,
    );

    const changeSummary = Object.entries(changes)
      .map(([field, { from, to }]) => `${field}: ${from ?? "—"} → ${to ?? "—"}`)
      .join(", ");
    await this.auditService.log({
      module: "Fee",
      action: "Updated",
      studentId: fee.student.id,
      recordId: fee.id,
      actingUser,
      description: `Updated fee for ${fee.student.name} (${fee.student.enrollmentNumber})${changeSummary ? ` — ${changeSummary}` : ""}`,
      changes: Object.keys(changes).length ? changes : undefined,
    });
    return fee;
  }

  async updateStatusTabs(
    id: string,
    data: Partial<
      Pick<Fee, "drop" | "dpt" | "bar" | "cancel" | "dropOfScholarship">
    >,
    actingUser: { id: string; role: string },
  ) {
    const fee = await this.feeRepo.findOne({ id }, { populate: ["student"] });
    if (!fee) throw new NotFoundException("Fee record not found");

    const changes: Record<string, { from: any; to: any }> = {};
    for (const key of Object.keys(data) as (keyof typeof data)[]) {
      if (data[key] !== undefined && data[key] !== (fee as any)[key]) {
        changes[key] = { from: (fee as any)[key], to: data[key] };
      }
    }

    Object.assign(fee, data);
    await this.feeRepo.getEntityManager().flush();
    await this.notifications.notifyRoles(
      ["Manager"],
      "StatusChange",
      `Status changed for ${fee.student.name} (${fee.student.enrollmentNumber})`,
      "Student",
      fee.student.id,
    );

    const changeSummary = Object.entries(changes)
      .map(([field, { to }]) => `${field} ${to ? "enabled" : "disabled"}`)
      .join(", ");
    await this.auditService.log({
      module: "Fee",
      action: "StatusChanged",
      studentId: fee.student.id,
      recordId: fee.id,
      actingUser,
      description: `Status changed for ${fee.student.name} (${fee.student.enrollmentNumber})${changeSummary ? ` — ${changeSummary}` : ""}`,
      changes: Object.keys(changes).length ? changes : undefined,
    });
    return fee;
  }
  // --- Customizable fee columns (dynamic schema via CustomFieldDefinition + JSONB) ---
  createFieldDefinition(
    name: string,
    dataType: string,
    createdByUserId?: string,
  ) {
    const def = this.fieldRepo.create({
      name,
      appliesTo: CustomFieldAppliesTo.FEE,
      dataType,
      createdByUserId,
    });
    return this.fieldRepo
      .getEntityManager()
      .persistAndFlush(def)
      .then(() => def);
  }

  listFieldDefinitions(appliesTo: CustomFieldAppliesTo) {
    return this.fieldRepo.find(
      { appliesTo },
      { orderBy: { columnOrder: "ASC", createdAt: "ASC" } },
    );
  }

  /**
   * Rename/update a dynamic fee column. Field values are stored keyed by the field's
   * *name* inside Fee.customValues, so renaming has to migrate every existing row's
   * key from the old name to the new one — otherwise old data would "disappear".
   */
  async updateFieldDefinition(
    id: string,
    data: { name?: string; dataType?: string },
  ) {
    const def = await this.fieldRepo.findOneOrFail({ id });
    const oldName = def.name;

    if (data.dataType) def.dataType = data.dataType;
    if (data.name && data.name.trim() && data.name.trim() !== oldName) {
      const newName = data.name.trim();
      const clash = await this.fieldRepo.findOne({
        appliesTo: def.appliesTo,
        name: newName,
      });
      if (clash && clash.id !== id) {
        throw new BadRequestException(
          `A column named "${newName}" already exists`,
        );
      }
      def.name = newName;
      await this.fieldRepo.getEntityManager().flush();

      if (def.appliesTo === CustomFieldAppliesTo.FEE) {
        const affected = await this.feeRepo.find({});
        for (const fee of affected) {
          if (
            fee.customValues &&
            Object.prototype.hasOwnProperty.call(fee.customValues, oldName)
          ) {
            fee.customValues[newName] = fee.customValues[oldName];
            delete fee.customValues[oldName];
          }
        }
        await this.feeRepo.getEntityManager().flush();
      } else {
        const affected = await this.studentRepo.find({});
        for (const student of affected) {
          if (
            student.customFields &&
            Object.prototype.hasOwnProperty.call(student.customFields, oldName)
          ) {
            student.customFields[newName] = student.customFields[oldName];
            delete student.customFields[oldName];
          }
        }
        await this.studentRepo.getEntityManager().flush();
      }
    } else {
      await this.fieldRepo.getEntityManager().flush();
    }

    return def;
  }

  async removeFieldDefinition(id: string) {
    const def = await this.fieldRepo.findOneOrFail({ id });
    await this.fieldRepo.getEntityManager().removeAndFlush(def);
    return { message: "Custom field removed" };
  }

  /**
   * Called from ApplicationsService whenever a reviewer adds an action entry with an amount
   * (Fine, DC, UMC, LateFee, DPT, Bar, Cancel, DropScholarship) — pushes that charge onto the
   * student's Fee page automatically, against their most recent/current semester.
   */
  async recordApplicationCharge(
    student: Student,
    actionType: string,
    amount: number,
    sourceTitle?: string,
  ) {
    let semesters = await this.semesterRepo.find(
      { student },
      { orderBy: { order: "DESC" }, limit: 1 },
    );
    let semester: Semester;
    if (semesters.length === 0) {
      const generated = await this.semestersService.generateInitial(
        student,
        new Date().getFullYear(),
      );
      semester = generated[0];
    } else {
      semester = semesters[0];
    }

    const fee = this.feeRepo.create({
      student,
      semester,
      feeType: actionType,
      amount: String(amount),
      customValues: sourceTitle
        ? { Source: `Application: ${sourceTitle}` }
        : {},
    });
    await this.feeRepo.getEntityManager().persistAndFlush(fee);

    await this.notifications.notifyRoles(
      ["Manager"],
      "FeeUpdated",
      `${actionType} charge of Rs ${amount} added to ${student.name} (${student.enrollmentNumber}) fee page from an application`,
      "Student",
      student.id,
    );

    return fee;
  }

  // Action type -> already-existing custom column jahan amount jaana chahiye
  // (naya row banane ke bajaye).
  private readonly APPLICATION_FINE_COLUMN_MAP: Record<string, string> = {
    UMC: "UMC/DC",
    DC: "UMC/DC",
    DPT: "DPT",
    Bar: "Bar Council",
    DropScholarship: "Drop of scholarship",
  };

  /**
   * Application se jab UMC/DC, DPT, Bar, DropScholarship jaisi fine aati hai,
   * to naya row banane ke bajaye us student ke us semester ke EXISTING fee row
   * (Excel import wala row) ke matching cell mein amount likh deta hai.
   * Agar action type ka koi dedicated column nahi hai (Fine, LateFee, Cancel, Custom)
   * to purana behavior (alag row) chalta rehta hai.
   */
  async postApplicationFine(
    studentId: string,
    semesterId: string,
    actionType: string,
    amount: number,
    sourceTitle?: string,
    actingUser: { id: string; role: string } = { id: "system", role: "System" },
  ) {
    const columnName = this.APPLICATION_FINE_COLUMN_MAP[actionType];

    if (!columnName) {
      return this.addFee(
        {
          studentId,
          semesterId,
          feeType: `fine:${actionType.toLowerCase()}`,
          amount,
          customValues: sourceTitle
            ? { Source: `Application: ${sourceTitle}` }
            : {},
        },
        actingUser,
      );
    }

    const student = await this.studentRepo.findOneOrFail({ id: studentId });
    const semester = await this.semesterRepo.findOneOrFail({ id: semesterId });

    // Pehle Excel-imported row dhoondo (jahan ye custom columns already hain),
    // warna is student/semester ka koi bhi maujood fee row le lo,
    // warna nayi row bana do taake cell ke liye jagah ho.
    let fee =
      (await this.feeRepo.findOne({
        student,
        semester,
        feeType: "Imported",
      })) || (await this.feeRepo.findOne({ student, semester }));

    if (!fee) {
      fee = this.feeRepo.create({
        student,
        semester,
        feeType: "Imported",
        amount: "0",
        customValues: {},
      });
    }

    const existingCellValue = Number(fee.customValues?.[columnName]) || 0;
    fee.customValues = {
      ...(fee.customValues || {}),
      [columnName]: existingCellValue + amount,
    };
    fee.amount = String(Number(fee.amount || 0) + amount);

    await this.feeRepo.getEntityManager().persistAndFlush(fee);

    await this.notifications.notifyRoles(
      ["Manager"],
      "FeeUpdated",
      `${actionType} fine of Rs ${amount} posted into the "${columnName}" column for ${student.name} (${student.enrollmentNumber})`,
      "Student",
      student.id,
    );

    await this.auditService.log({
      module: "Fee",
      action: "StatusChanged",
      studentId: student.id,
      recordId: fee.id,
      actingUser,
      description: `${actionType} fine of Rs ${amount.toLocaleString()} posted into "${columnName}" for ${student.name} (${student.enrollmentNumber})`,
      changes: {
        [columnName]: {
          from: existingCellValue,
          to: existingCellValue + amount,
        },
      },
    });

    return fee;
  }

  // --- Fee Excel Import ---
  // Reads a raw fee sheet exactly as prepared by the university (e.g. "FEE DETAIL FALL-2026")
  // and imports it without forcing the data into predefined columns. Whatever column headers
  // exist in the sheet become dynamic fee fields automatically (name + data, verbatim) — new
  // ones are registered as CustomFieldDefinitions on the fly, matching ones are reused.
  async importExcel(
    buffer: Buffer,
    semesterLabel: string,
    createdByUserId?: string,
  ) {
    if (!semesterLabel || !semesterLabel.trim()) {
      throw new BadRequestException(
        'Semester label is required (e.g. "Fall 2026")',
      );
    }

    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const grid: any[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
      raw: true,
    });

    // Real-world sheets often have title rows above the actual header row
    // (e.g. "FEE DETAIL FALL-2026" / "2nd Semester to Onwards"). Find the row
    // that actually looks like a header — the first row containing a Roll/Enrollment cell.
    let headerRowIdx = -1;
    for (let r = 0; r < Math.min(grid.length, 15); r++) {
      const row = grid[r] || [];
      if (
        row.some(
          (cell) => typeof cell === "string" && /roll|enrollment/i.test(cell),
        )
      ) {
        headerRowIdx = r;
        break;
      }
    }
    if (headerRowIdx === -1) {
      throw new BadRequestException(
        "Could not find a header row containing a Roll/Enrollment Number column",
      );
    }

    const rawHeaders: any[] = grid[headerRowIdx];
    const rollColIdx = rawHeaders.findIndex(
      (h) => typeof h === "string" && /roll|enrollment/i.test(h),
    );
    // Identity columns used to auto-create a missing Student while importing fees —
    // real sheets combine student identity + fee data in one file (e.g. "Pregame" typo for Program).
    const nameColIdx = rawHeaders.findIndex(
      (h) => typeof h === "string" && /^\s*(student\s*)?name\s*$/i.test(h),
    );
    const programColIdx = rawHeaders.findIndex(
      (h) => typeof h === "string" && /^\s*(pregame|program)\s*$/i.test(h),
    );
    const sectionColIdx = rawHeaders.findIndex(
      (h) => typeof h === "string" && /^\s*section\s*$/i.test(h),
    );

    // "Adm Session" (e.g. "Spring 2022") + "Degree Years" (e.g. "4") drive automatic
    // semester-roadmap generation for each matched student — see the per-row loop
    // below and SemestersService.generateFromAdmission. Header matching is
    // punctuation/whitespace-tolerant so "Adm Session", "Admission Session",
    // "Adm. Session" and "AdmSession" all resolve the same column.
    const normalizeHeader = (h: any) =>
      String(h)
        .replace(/[\s.]+/g, "")
        .toLowerCase();
    const admSessionColIdx = rawHeaders.findIndex(
      (h) =>
        typeof h === "string" &&
        /^adm(ission)?session$/i.test(normalizeHeader(h)),
    );
    const degreeYearsColIdx = rawHeaders.findIndex(
      (h) =>
        typeof h === "string" &&
        (/^degreeyears?$/i.test(normalizeHeader(h)) ||
          /^programyears?$/i.test(normalizeHeader(h)) ||
          /^programduration(years)?$/i.test(normalizeHeader(h))),
    );

    // Build column definitions: index -> { name, isIdentity }, de-duplicating repeated headers
    // (e.g. two "Due Date" columns) by suffixing " (2)", " (3)", etc.
    const seenNames = new Map<string, number>();
    const columns: { index: number; name: string; isIdentity: boolean }[] = [];
    rawHeaders.forEach((h, idx) => {
      if (h === null || h === undefined || String(h).trim() === "") return;
      let name = String(h).replace(/\s+/g, " ").trim();
      const isIdentity = IDENTITY_COLUMN_PATTERNS.some((p) => p.test(name));
      if (!isIdentity) {
        const count = seenNames.get(name) || 0;
        seenNames.set(name, count + 1);
        if (count > 0) name = `${name} (${count + 1})`;
      }
      columns.push({ index: idx, name, isIdentity });
    });

    const feeColumns = columns.filter((c) => !c.isIdentity);

    // Ensure a CustomFieldDefinition exists for every fee column in the sheet.
    const existingDefs = await this.fieldRepo.find({
      appliesTo: CustomFieldAppliesTo.FEE,
    });
    const defsByName = new Map(existingDefs.map((d) => [d.name, d]));
    let maxOrder = existingDefs.reduce(
      (m, d) => Math.max(m, d.columnOrder || 0),
      0,
    );
    const newColumnsCreated: string[] = [];

    for (const col of feeColumns) {
      if (!defsByName.has(col.name)) {
        const def = this.fieldRepo.create({
          name: col.name,
          appliesTo: CustomFieldAppliesTo.FEE,
          dataType: "text",
          columnOrder: ++maxOrder,
          createdByUserId,
        });
        await this.fieldRepo.getEntityManager().persistAndFlush(def);
        defsByName.set(col.name, def);
        newColumnsCreated.push(col.name);
      }
    }

    // Prefer these (in order) as the "headline" amount synced into Fee.amount for totals.
    const AMOUNT_PRIORITY = [
      /^grand total$/i,
      /^fee$/i,
      /^total fee$/i,
      /^amount$/i,
    ];

    // The sheet's own Status/Balance/Due Date columns — used to also sync the app's
    // paidStatus / paidAmount / dueDate fields (badges, filters, and summary totals all
    // read these, not customValues), instead of leaving them stuck at "unpaid" / 0 / blank.
    const statusCol = feeColumns.find((c) => /^status$/i.test(c.name));
    const balanceCol = feeColumns.find((c) => /^balance$/i.test(c.name));
    const dueDateCol = feeColumns.find((c) => /^due date$/i.test(c.name));

    let importedCount = 0;
    let updatedCount = 0;
    let createdCount = 0;
    let studentsCreatedCount = 0;
    let semestersAutoGeneratedCount = 0;
    const skipped: { row: number; reason: string }[] = [];
    const studentsCreated: string[] = [];
    const studentsWithRoadmapGenerated: string[] = [];

    for (let r = headerRowIdx + 1; r < grid.length; r++) {
      const row = grid[r];
      if (!row || row.every((c) => c === null || c === undefined || c === ""))
        continue;

      const rollValue = rollColIdx >= 0 ? row[rollColIdx] : null;
      if (
        rollValue === null ||
        rollValue === undefined ||
        String(rollValue).trim() === ""
      ) {
        continue; // blank row / sub-header
      }
      // Normalize away hidden characters that commonly sneak in from
      // copy-pasted Excel/Word data (non-breaking spaces, zero-width spaces)
      // and collapse any accidental double spaces — these cause a roll number
      // that LOOKS identical to an existing student's but fails an exact/ilike
      // match, which previously caused a duplicate-create attempt to crash the
      // whole import.
      const enrollmentNumber = String(rollValue)
        .replace(/[\u00A0\u200B\u200C\u200D\uFEFF]/g, "")
        .trim()
        .replace(/\s+/g, " ");

      let student = await this.studentRepo.findOne({
        enrollmentNumber: { $ilike: enrollmentNumber },
      });

      if (!student) {
        // Student doesn't exist yet — the sheet already carries their identity data
        // (Name / Pregame-Program / Section), so create them on the fly instead of
        // skipping the row. This is how a combined student+fee sheet imports in one go.
        const nameValue =
          nameColIdx >= 0 &&
          row[nameColIdx] !== null &&
          row[nameColIdx] !== undefined
            ? String(row[nameColIdx]).trim()
            : "";
        const programValue =
          programColIdx >= 0 &&
          row[programColIdx] !== null &&
          row[programColIdx] !== undefined
            ? String(row[programColIdx]).trim()
            : undefined;
        const sectionValue =
          sectionColIdx >= 0 &&
          row[sectionColIdx] !== null &&
          row[sectionColIdx] !== undefined
            ? String(row[sectionColIdx]).trim()
            : undefined;

        try {
          student = this.studentRepo.create({
            enrollmentNumber,
            name: nameValue || "Unknown",
            program: programValue || undefined,
            section: sectionValue || undefined,
            createdBy: createdByUserId,
          } as Student);
          await this.studentRepo.getEntityManager().persistAndFlush(student);
          studentsCreatedCount++;
          studentsCreated.push(enrollmentNumber);
        } catch (err: any) {
          // Self-healing for the case where a student with this exact enrollment
          // number already exists in the DB (e.g. hidden whitespace/character
          // difference broke the $ilike match above, or a prior import created
          // them) but the unique constraint on enrollment_number still catches it
          // at the DB level. Instead of letting the whole import crash on this one
          // row, detach the failed insert and re-fetch the real existing row so
          // this row's fees still get attached to the correct student.
          const isUniqueViolation =
            err?.code === "23505" ||
            /unique constraint/i.test(err?.message || "");
          if (!isUniqueViolation) throw err;

          this.studentRepo.getEntityManager().clear();
          const existing = await this.studentRepo.findOne({
            enrollmentNumber: { $ilike: enrollmentNumber },
          });
          if (!existing) {
            // Truly unexpected — surface the original error rather than silently
            // skipping the row.
            throw err;
          }
          student = existing;
          skipped.push({
            row: r + 1,
            reason: `Enrollment "${enrollmentNumber}" already existed with a hidden formatting difference — matched to existing student instead of creating a duplicate.`,
          });
        }
      }

      // If this row carries "Adm Session" + "Degree Years", (re)build the student's
      // complete semester roadmap anchored at their actual admission session —
      // e.g. Adm Session "Spring 2022" + Degree Years "4" generates Spring 2022,
      // Fall 2022, Spring 2023, Fall 2023, ... Fall 2025 (8 semesters), in that
      // exact chronological order. Idempotent: does nothing if the student already
      // has semesters (e.g. from a prior import), so re-importing never duplicates.
      const admSessionRaw =
        admSessionColIdx >= 0 ? row[admSessionColIdx] : null;
      const degreeYearsRaw =
        degreeYearsColIdx >= 0 ? row[degreeYearsColIdx] : null;
      if (admSessionRaw && degreeYearsRaw) {
        const parsedSession =
          this.semestersService.parseSessionLabel(admSessionRaw);
        const years = this.semestersService.parseDegreeYears(degreeYearsRaw);
        if (parsedSession && years && years > 0) {
          if (student.programDurationYears !== years) {
            student.programDurationYears = years;
          }
          const result = await this.semestersService.generateFromAdmission(
            student,
            parsedSession.type as SemesterType,
            parsedSession.year,
            years,
          );
          if (result.generated) {
            semestersAutoGeneratedCount++;
            studentsWithRoadmapGenerated.push(enrollmentNumber);
          }
        }
      }

      const semester = await this.semestersService.findOrCreateByLabel(
        student,
        semesterLabel,
      );

      const customValues: Record<string, any> = {};
      for (const col of feeColumns) {
        let value = row[col.index];
        if (value instanceof Date) value = value.toISOString().slice(0, 10);
        customValues[col.name] = value === undefined ? null : value;
      }

      // Sync the "headline" total into Fee.amount (used for semester/grand totals in the UI),
      // preferring Grand Total > FEE > Total Fee > Amount — in that priority order, not sheet
      // order. A column that's blank/0 in this row is treated as "not set" so a real value in
      // a lower-priority column (e.g. FEE = 100000 when Grand Total was left blank/0) still wins.
      let amount: number | undefined;
      for (const pattern of AMOUNT_PRIORITY) {
        const col = feeColumns.find((c) => pattern.test(c.name));
        if (
          col &&
          typeof customValues[col.name] === "number" &&
          customValues[col.name] > 0
        ) {
          amount = customValues[col.name];
          break;
        }
      }
      if (amount === undefined) {
        // Every priority column was blank/0 for this row — fall back to whichever of
        // them actually exists (even if 0) so Amount isn't left completely unset.
        for (const pattern of AMOUNT_PRIORITY) {
          const col = feeColumns.find((c) => pattern.test(c.name));
          if (col && typeof customValues[col.name] === "number") {
            amount = customValues[col.name];
            break;
          }
        }
      }

      // Sync Paid Status from the sheet's own STATUS column ("Full Paid" / "Unpaid" /
      // "Partial") — previously this was never read, so every imported row stayed stuck
      // on the entity's "unpaid" default no matter what the sheet said.
      let paidStatus: string | undefined;
      const statusText = statusCol
        ? String(customValues[statusCol.name] ?? "").trim()
        : "";
      if (/unpaid|not\s*paid|pending|due/i.test(statusText)) {
        paidStatus = "unpaid";
      } else if (/partial/i.test(statusText)) {
        paidStatus = "partial";
      } else if (/paid/i.test(statusText)) {
        paidStatus = "paid";
      }

      // Paid Amount: Amount minus Balance when the sheet has a Balance column (most
      // accurate), otherwise the full amount when the sheet says it's paid. If a Balance
      // column exists but STATUS didn't give us a clear answer, derive paidStatus from it too.
      let paidAmount: number | undefined;
      const balanceValue = balanceCol
        ? customValues[balanceCol.name]
        : undefined;
      if (amount !== undefined && typeof balanceValue === "number") {
        paidAmount = Math.max(0, amount - balanceValue);
        if (!paidStatus) {
          paidStatus =
            balanceValue <= 0
              ? "paid"
              : balanceValue >= amount
                ? "unpaid"
                : "partial";
        }
      } else if (paidStatus === "paid" && amount !== undefined) {
        paidAmount = amount;
      }

      // Due Date: the sheet's own Due Date column, already a real JS Date thanks to
      // cellDates on the workbook read (previously this showed as a raw Excel serial
      // number like 46154 because dates were read as plain numbers).
      const dueDateValue = dueDateCol ? row[dueDateCol.index] : undefined;
      const dueDate = dueDateValue instanceof Date ? dueDateValue : undefined;

      let fee = await this.feeRepo.findOne({
        student,
        semester,
        feeType: "Imported",
      });
      if (fee) {
        fee.customValues = { ...(fee.customValues || {}), ...customValues };
        if (amount !== undefined) fee.amount = String(amount);
        if (paidStatus !== undefined) fee.paidStatus = paidStatus;
        if (paidAmount !== undefined) fee.paidAmount = String(paidAmount);
        if (dueDate) fee.dueDate = dueDate;
        updatedCount++;
      } else {
        fee = this.feeRepo.create({
          student,
          semester,
          feeType: "Imported",
          amount: amount !== undefined ? String(amount) : "0",
          paidStatus: paidStatus || "unpaid",
          paidAmount: paidAmount !== undefined ? String(paidAmount) : "0",
          dueDate,
          customValues,
        });
        this.feeRepo.getEntityManager().persist(fee);
        createdCount++;
      }
      importedCount++;
    }

    await this.feeRepo.getEntityManager().flush();

    return {
      semesterLabel,
      totalDataRows: grid.length - headerRowIdx - 1,
      importedCount,
      createdCount,
      updatedCount,
      studentsCreatedCount,
      studentsCreated,
      semestersAutoGeneratedCount,
      studentsWithRoadmapGenerated,
      skippedCount: skipped.length,
      skipped,
      newColumnsCreated,
      columnsUsed: feeColumns.map((c) => c.name),
    };
  }
}
