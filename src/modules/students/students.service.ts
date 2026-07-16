import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { EntityRepository } from "@mikro-orm/postgresql";
import { InjectRepository } from "@mikro-orm/nestjs";
import * as XLSX from "xlsx";
import {
  CustomFieldAppliesTo,
  CustomFieldDefinition,
  Student,
  StudentCategory,
  UserRole,
} from "../../entities";

export interface StudentFilters {
  search?: string;
  category?: string;
  program?: string;
  createdBy?: string;
  missingMatric?: boolean;
  missingInter?: boolean;
  missingDegreeSession?: boolean;
}

@Injectable()
export class StudentsService {
  constructor(
    @InjectRepository(Student) private studentRepo: EntityRepository<Student>,
    @InjectRepository(CustomFieldDefinition)
    private fieldRepo: EntityRepository<CustomFieldDefinition>,
  ) {}

  findAll(search?: string) {
    // Kept for backward compatibility; prefer findAllFiltered.
    return this.findAllFiltered({ search });
  }

  async findAllFiltered(filters: StudentFilters) {
    const conditions: string[] = [];
    const params: any[] = [];

    // IMPORTANT: MikroORM's `connection.execute(sql, params)` does NOT understand
    // Postgres-native `$1`/`$2` placeholders — its formatQuery() only substitutes
    // literal `?` characters (knex-style), in order, one-for-one with the params
    // array. Using `$1`/`$2` here silently drops the params (formatQuery finds no
    // `?` to replace) and Postgres then rejects the literal "$1" text with
    // "there is no parameter $1". This was the actual root cause of every filter —
    // search, program, category, missing matric/inter — failing at once, since ANY
    // WHERE condition at all would hit this and crash the query.
    if (filters.search && filters.search.trim()) {
      // Search across every identifier Record Room / Admission Center staff actually
      // use to look a student up: enrollment number, registration ID, CNIC/B-Form,
      // roll number, name, father's name, program, email, and any admin-defined
      // custom fields. (These columns do exist on the `students` table — the old
      // version of this query skipped them due to a stale comment about the
      // original migration, which was never updated after the entity grew these
      // fields.)
      const term = `%${filters.search.trim()}%`;
      conditions.push(
        `(s.enrollment_number ILIKE ? OR s.registration_id ILIKE ? OR s.cnic ILIKE ? OR s.roll_no ILIKE ? OR s.name ILIKE ? OR s.father_name ILIKE ? OR s.program ILIKE ? OR s.email ILIKE ? OR CAST(s.custom_fields AS text) ILIKE ?)`,
      );
      // One `?` per column above — the same value is pushed once per placeholder,
      // in the exact order the `?`s appear in the string.
      params.push(term, term, term, term, term, term, term, term, term);
    }
    if (filters.category) {
      conditions.push(`s.student_category = ?`);
      params.push(filters.category);
    }
    if (filters.program && filters.program.trim()) {
      conditions.push(`s.program ILIKE ?`);
      params.push(`%${filters.program.trim()}%`);
    }
    if (filters.createdBy) {
      conditions.push(`s.created_by = ?`);
      params.push(filters.createdBy);
    }

    // "Missing X" checkboxes: when more than one is ticked at once, Record Room
    // wants students missing ANY of the ticked items (OR), not only students missing
    // every ticked item at the same time (AND). The old AND-only version meant
    // ticking both "Missing Matric" and "Missing Inter" together almost always came
    // back empty even though plenty of students were missing one or the other.
    // (These sub-conditions take no params, so no `?` placeholders needed here.)
    const missingConditions: string[] = [];
    if (filters.missingMatric) {
      missingConditions.push(
        `NOT EXISTS (SELECT 1 FROM academic_records ar WHERE ar.student_id = s.id AND ar.level = 'Matric')`,
      );
    }
    if (filters.missingInter) {
      missingConditions.push(
        `NOT EXISTS (SELECT 1 FROM academic_records ar WHERE ar.student_id = s.id AND ar.level = 'Intermediate')`,
      );
    }
    if (filters.missingDegreeSession) {
      missingConditions.push(
        `NOT EXISTS (SELECT 1 FROM academic_records ar WHERE ar.student_id = s.id AND ar.level = 'Degree')`,
      );
    }
    if (missingConditions.length === 1) {
      conditions.push(missingConditions[0]);
    } else if (missingConditions.length > 1) {
      conditions.push(`(${missingConditions.join(" OR ")})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    // Sanity check: the number of `?` placeholders in the final SQL must match
    // the number of params we're about to bind, or MikroORM/knex will bind them
    // to the wrong columns (or throw). Cheap guard against future regressions.
    const placeholderCount = (where.match(/\?/g) || []).length;
    if (placeholderCount !== params.length) {
      throw new Error(
        `Student filters query has ${placeholderCount} placeholders but ${params.length} params were built — they must match.`,
      );
    }

    const rows = await this.studentRepo
      .getEntityManager()
      .getConnection()
      .execute(
        `SELECT s.id FROM students s ${where} ORDER BY s.created_at DESC`,
        params,
      );
    const ids = rows.map((r: any) => r.id);
    if (ids.length === 0) return [];
    const students = await this.studentRepo.find(
      { id: { $in: ids } },
      { orderBy: { createdAt: "DESC" } },
    );
    return students;
  }

  async findByEnrollment(enrollmentNumber: string) {
    const value = (enrollmentNumber || "").trim();
    const student = await this.studentRepo.findOne({
      enrollmentNumber: { $ilike: value },
    });
    if (!student)
      throw new NotFoundException(
        "Student not found for this Enrollment/Roll Number",
      );
    return student;
  }

  async findOne(id: string) {
    const student = await this.studentRepo.findOne({ id });
    if (!student) throw new NotFoundException("Student not found");
    return student;
  }

  async create(data: Partial<Student>, user: any) {
    const enrollmentNumber = String(data.enrollmentNumber || "").trim();
    if (!enrollmentNumber) {
      throw new BadRequestException("Enrollment Number is required");
    }
    const registrationId = data.registrationId
      ? String(data.registrationId).trim()
      : undefined;

    const existing = await this.studentRepo.findOne({
      enrollmentNumber: { $ilike: enrollmentNumber },
    });
    if (existing)
      throw new BadRequestException(
        "A student with this Enrollment Number already exists",
      );

    if (registrationId) {
      const dupReg = await this.studentRepo.findOne({
        registrationId: { $ilike: registrationId },
      });
      if (dupReg)
        throw new BadRequestException(
          "A student with this Registration ID already exists",
        );
    }

    const payload: Partial<Student> = {
      ...data,
      enrollmentNumber,
      registrationId,
      cnic: data.cnic ? String(data.cnic).trim() : data.cnic,
      rollNo: data.rollNo ? String(data.rollNo).trim() : data.rollNo,
      createdBy: user?.id,
    };

    // Anything registered by the Admission Center starts life as a "New Admission"
    // so Record Room can see it and complete the remaining fields.
    if (user?.role === UserRole.ADMISSION_CENTER) {
      payload.studentCategory = StudentCategory.NEW_ADMISSION;
    }

    const student = this.studentRepo.create(payload as Student);
    await this.studentRepo.getEntityManager().persistAndFlush(student);
    return student;
  }

  async update(id: string, data: Partial<Student>, user?: any) {
    const student = await this.findOne(id);

    // Admission Center can only ever touch records it registered itself.
    if (user?.role === UserRole.ADMISSION_CENTER) {
      if (student.createdBy !== user.id) {
        throw new ForbiddenException(
          "You can only update students you registered yourself",
        );
      }
    }

    if (
      data.registrationId &&
      data.registrationId.trim() !== (student.registrationId || "")
    ) {
      const registrationId = data.registrationId.trim();
      const dupReg = await this.studentRepo.findOne({
        registrationId: { $ilike: registrationId },
      });
      if (dupReg && dupReg.id !== id)
        throw new BadRequestException(
          "A student with this Registration ID already exists",
        );
      data = { ...data, registrationId };
    }

    if (data.enrollmentNumber) {
      const enrollmentNumber = String(data.enrollmentNumber).trim();
      if (enrollmentNumber !== student.enrollmentNumber) {
        const dupEnrollment = await this.studentRepo.findOne({
          enrollmentNumber: { $ilike: enrollmentNumber },
        });
        if (dupEnrollment && dupEnrollment.id !== id)
          throw new BadRequestException(
            "A student with this Enrollment Number already exists",
          );
      }
      data = { ...data, enrollmentNumber };
    }
    if (data.cnic) data = { ...data, cnic: String(data.cnic).trim() };
    if (data.rollNo) data = { ...data, rollNo: String(data.rollNo).trim() };

    Object.assign(student, data);
    await this.studentRepo.getEntityManager().flush();
    return student;
  }

  async remove(id: string) {
    const student = await this.findOne(id);
    await this.studentRepo.getEntityManager().removeAndFlush(student);
    return { message: "Student deleted" };
  }

  // --- Dynamic custom columns for Students ---
  listFieldDefinitions() {
    return this.fieldRepo.find(
      { appliesTo: CustomFieldAppliesTo.STUDENT },
      { orderBy: { columnOrder: "ASC", createdAt: "ASC" } },
    );
  }

  async createFieldDefinition(
    name: string,
    dataType: string,
    createdByUserId?: string,
  ) {
    const existing = await this.fieldRepo.findOne({
      appliesTo: CustomFieldAppliesTo.STUDENT,
      name: { $ilike: name },
    });
    if (existing) return existing;

    const def = this.fieldRepo.create({
      name,
      appliesTo: CustomFieldAppliesTo.STUDENT,
      dataType,
      createdByUserId,
    });
    await this.fieldRepo.getEntityManager().persistAndFlush(def);
    return def;
  }

  async removeFieldDefinition(id: string) {
    const def = await this.fieldRepo.findOneOrFail({ id });
    await this.fieldRepo.getEntityManager().removeAndFlush(def);
    return { message: "Custom field removed" };
  }

  private inferDataType(value: any): string {
    if (value === null || value === undefined || value === "") return "text";
    if (typeof value === "boolean") return "boolean";
    if (typeof value === "number") return "number";
    if (value instanceof Date) return "date";
    const str = String(value).trim();
    if (/^-?\d+(\.\d+)?$/.test(str)) return "number";
    if (
      /^\d{4}-\d{2}-\d{2}$/.test(str) ||
      /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(str)
    )
      return "date";
    if (/^(true|false|yes|no)$/i.test(str)) return "boolean";
    return "text";
  }

  /**
   * Bulk import from an Excel sheet. Any column not in the known list is
   * auto-registered as a dynamic custom column (see CustomFieldDefinition)
   * and stored under customFields on the student.
   *
   * Real-world sheets (e.g. exported from Excel by admin staff) often have title
   * rows above the actual header row ("FEE DETAIL FALL-2026" / "2nd Semester to
   * Onwards") and use different header wording than our internal field names
   * (e.g. "Roll #" instead of "Enrollment Number", "Pregame" — a common typo —
   * instead of "Program"). This parses the sheet the same title-row-tolerant way
   * the Fee importer does, then maps recognized identity headers onto Student's
   * real fields so data lands in the correct place instead of being dropped.
   */
  async importExcel(buffer: Buffer, createdBy?: string) {
    // cellDates: true is essential — without it, date-valued cells (DOB, Admission
    // Date, Add Date, etc.) come back as raw Excel serial numbers (e.g. 46001)
    // instead of real dates, which is why some sheet data looked wrong/missing.
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const grid: any[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
      raw: true,
    });

    // Find the real header row — the first row (within the first 15) containing a
    // Roll/Enrollment-looking cell — skipping any title/subtitle rows above it.
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

    // Identity columns mapped straight onto Student's real fields, with the real-world
    // header spellings we've seen ("Roll #", "Pregame" typo for Program, "Applicant ID"
    // for the admission office's own reference number, etc.). Order matters: more
    // specific patterns (e.g. "First Name") are checked before the generic "name" one
    // via the dedicated firstName/lastName handling below, so a sheet that has both
    // "First Name" and "Last Name" gets them combined into one full name instead of
    // one silently winning and the other becoming a stray custom column.
    const IDENTITY_MAP: { field: keyof Student; pattern: RegExp }[] = [
      {
        field: "enrollmentNumber",
        pattern: /^\s*(roll\s*(#|no\.?)?|enrollment\s*(number|no\.?)?)\s*$/i,
      },
      {
        field: "name",
        pattern: /^\s*(student\s*|full\s*)?name\s*$/i,
      },
      {
        field: "registrationId",
        pattern:
          /^\s*(applicant\s*(id|no\.?|number)?|registration\s*(id|no\.?|number)?)\s*$/i,
      },
      { field: "cnic", pattern: /^\s*cnic\s*(#|no\.?)?\s*$/i },
      { field: "program", pattern: /^\s*(pregame|program)\s*$/i },
      { field: "section", pattern: /^\s*section\s*$/i },
      { field: "email", pattern: /^\s*email\s*(address)?\s*$/i },
      { field: "semesterSystem", pattern: /^\s*semester\s*system\s*$/i },
    ];

    const identityColIdx = new Map<keyof Student, number>();
    let firstNameIdx: number | undefined;
    let lastNameIdx: number | undefined;
    rawHeaders.forEach((h, idx) => {
      if (typeof h !== "string" || !h.trim()) return;
      if (!identityColIdx.has("name")) {
        if (/^\s*first\s*name\s*$/i.test(h)) {
          firstNameIdx = idx;
          return;
        }
        if (/^\s*last\s*name\s*$/i.test(h)) {
          lastNameIdx = idx;
          return;
        }
      }
      const match = IDENTITY_MAP.find((m) => m.pattern.test(h));
      if (match && !identityColIdx.has(match.field)) {
        identityColIdx.set(match.field, idx);
      }
    });

    // Everything else becomes a dynamic custom column, de-duplicating repeated
    // headers (e.g. two "Due Date" columns) by suffixing " (2)", " (3)", etc.
    const seenNames = new Map<string, number>();
    const customColumns: { index: number; name: string }[] = [];
    const identityIndexes = new Set(identityColIdx.values());
    if (firstNameIdx !== undefined) identityIndexes.add(firstNameIdx);
    if (lastNameIdx !== undefined) identityIndexes.add(lastNameIdx);
    rawHeaders.forEach((h, idx) => {
      if (identityIndexes.has(idx)) return;
      if (h === null || h === undefined || String(h).trim() === "") return;
      // Skip the "Sr. #" row-counter column — it's neither identity nor useful data.
      if (/^sr\.?\s*#?$/i.test(String(h).trim())) return;
      let name = String(h).replace(/\s+/g, " ").trim();
      const count = seenNames.get(name) || 0;
      seenNames.set(name, count + 1);
      if (count > 0) name = `${name} (${count + 1})`;
      customColumns.push({ index: idx, name });
    });

    const created: string[] = [];
    const skippedDuplicates: string[] = [];
    const errors: string[] = [];
    const newColumnsCreated: string[] = [];

    const existingDefs = await this.fieldRepo.find({
      appliesTo: CustomFieldAppliesTo.STUDENT,
    });
    const defsByName = new Map(existingDefs.map((d) => [d.name, d]));

    for (let r = headerRowIdx + 1; r < grid.length; r++) {
      const row = grid[r];
      const rowNum = r + 1;
      if (!row || row.every((c) => c === null || c === undefined || c === ""))
        continue; // blank row

      const enrollColIdx = identityColIdx.get("enrollmentNumber");
      const rawEnrollment =
        enrollColIdx !== undefined ? row[enrollColIdx] : null;
      if (
        rawEnrollment === null ||
        rawEnrollment === undefined ||
        String(rawEnrollment).trim() === ""
      ) {
        errors.push(`Row ${rowNum}: missing Enrollment/Roll Number — skipped`);
        continue;
      }
      const enrollmentNumber = String(rawEnrollment).trim();

      const existing = await this.studentRepo.findOne({
        enrollmentNumber: { $ilike: enrollmentNumber },
      });
      if (existing) {
        skippedDuplicates.push(enrollmentNumber);
        continue;
      }

      const getIdentity = (field: keyof Student): string | undefined => {
        const idx = identityColIdx.get(field);
        if (idx === undefined) return undefined;
        let value: any = row[idx];
        if (
          value === null ||
          value === undefined ||
          String(value).trim() === ""
        )
          return undefined;
        if (value instanceof Date) value = value.toISOString().slice(0, 10);
        return String(value).trim();
      };

      // Prefer an explicit "Name" column; otherwise combine "First Name" + "Last
      // Name" when the sheet splits them across two columns.
      let name = getIdentity("name");
      if (!name && (firstNameIdx !== undefined || lastNameIdx !== undefined)) {
        const first =
          firstNameIdx !== undefined
            ? String(row[firstNameIdx] ?? "").trim()
            : "";
        const last =
          lastNameIdx !== undefined
            ? String(row[lastNameIdx] ?? "").trim()
            : "";
        name = [first, last].filter(Boolean).join(" ").trim() || undefined;
      }

      // "Applicant ID" / "Registration ID" is only safe to set if it isn't already
      // used by another student — unlike enrollment number, we don't skip the whole
      // row over a clash here, we just leave it blank and note it so the rest of
      // that row's data (name, program, custom fields, etc.) still lands.
      let registrationId = getIdentity("registrationId");
      if (registrationId) {
        const dupReg = await this.studentRepo.findOne({
          registrationId: { $ilike: registrationId },
        });
        if (dupReg) {
          errors.push(
            `Row ${rowNum}: Applicant/Registration ID "${registrationId}" already used by another student — left blank for this row`,
          );
          registrationId = undefined;
        }
      }

      const customFields: Record<string, any> = {};
      for (const col of customColumns) {
        let value = row[col.index];
        if (value === null || value === undefined || value === "") continue;
        if (value instanceof Date) value = value.toISOString().slice(0, 10);

        if (!defsByName.has(col.name)) {
          const dataType = this.inferDataType(value);
          const def = await this.createFieldDefinition(
            col.name,
            dataType,
            createdBy,
          );
          defsByName.set(def.name, def);
          newColumnsCreated.push(def.name);
        }
        customFields[col.name] = value;
      }

      const student = this.studentRepo.create({
        enrollmentNumber,
        registrationId,
        name: name || "Unknown",
        cnic: getIdentity("cnic"),
        section: getIdentity("section"),
        program: getIdentity("program"),
        email: getIdentity("email"),
        customFields,
        createdBy,
      } as Student);
      try {
        await this.studentRepo.getEntityManager().persistAndFlush(student);
        created.push(student.enrollmentNumber);
      } catch (err: any) {
        errors.push(
          `Row ${rowNum} (${enrollmentNumber}): failed to save — ${err?.message || err}`,
        );
      }
    }

    return {
      totalRows: grid.length - headerRowIdx - 1,
      createdCount: created.length,
      skippedDuplicateCount: skippedDuplicates.length,
      newColumnsCreated,
      created,
      skippedDuplicates,
      errors,
    };
  }
}
