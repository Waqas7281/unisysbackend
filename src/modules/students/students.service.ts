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
import { AuditService } from "../audit/audit.service";

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
    private auditService: AuditService,
  ) {}

  findAll(search?: string) {
    return this.findAllFiltered({ search });
  }

  async findAllFiltered(filters: StudentFilters) {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filters.search && filters.search.trim()) {
      const term = `%${filters.search.trim()}%`;
      conditions.push(
        `(s.enrollment_number ILIKE ? OR s.registration_id ILIKE ? OR s.cnic ILIKE ? OR s.roll_no ILIKE ? OR s.name ILIKE ? OR s.father_name ILIKE ? OR s.program ILIKE ? OR s.email ILIKE ? OR CAST(s.custom_fields AS text) ILIKE ?)`,
      );
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

    if (user?.role === UserRole.ADMISSION_CENTER) {
      payload.studentCategory = StudentCategory.NEW_ADMISSION;
    }

    const student = this.studentRepo.create(payload as Student);
    await this.studentRepo.getEntityManager().persistAndFlush(student);
    if (user?.id) {
      await this.auditService.log({
        module: "Student",
        action: "Created",
        studentId: student.id,
        recordId: student.id,
        actingUser: user,
        description: `Registered student ${student.name} (${student.enrollmentNumber})`,
      });
    }
    return student;
  }

  async update(id: string, data: Partial<Student>, user?: any) {
    const student = await this.findOne(id);

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

    const trackedFields: (keyof Student)[] = [
      "name",
      "enrollmentNumber",
      "registrationId",
      "cnic",
      "program",
      "section",
      "studentCategory",
    ];
    const changes: Record<string, { from: any; to: any }> = {};
    for (const field of trackedFields) {
      if (
        Object.prototype.hasOwnProperty.call(data, field) &&
        String((data as any)[field]) !== String((student as any)[field])
      ) {
        changes[field] = {
          from: (student as any)[field],
          to: (data as any)[field],
        };
      }
    }

    Object.assign(student, data);
    await this.studentRepo.getEntityManager().flush();

    if (user?.id && Object.keys(changes).length) {
      const changeSummary = Object.entries(changes)
        .map(
          ([field, { from, to }]) => `${field}: ${from ?? "—"} → ${to ?? "—"}`,
        )
        .join(", ");
      await this.auditService.log({
        module: "Student",
        action: "Updated",
        studentId: student.id,
        recordId: student.id,
        actingUser: user,
        description: `Updated ${student.name} (${student.enrollmentNumber}) — ${changeSummary}`,
        changes,
      });
    }
    return student;
  }

  async remove(id: string, user?: any) {
    const student = await this.findOne(id);
    const summary = `${student.name} (${student.enrollmentNumber})`;
    await this.studentRepo.getEntityManager().removeAndFlush(student);
    if (user?.id) {
      await this.auditService.log({
        module: "Student",
        action: "Deleted",
        recordId: id,
        actingUser: user,
        description: `Deleted student ${summary}`,
      });
    }
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

  async importExcel(buffer: Buffer, createdBy?: string) {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const grid: any[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
      raw: true,
    });

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

    const seenNames = new Map<string, number>();
    const customColumns: { index: number; name: string }[] = [];
    const identityIndexes = new Set(identityColIdx.values());
    if (firstNameIdx !== undefined) identityIndexes.add(firstNameIdx);
    if (lastNameIdx !== undefined) identityIndexes.add(lastNameIdx);
    rawHeaders.forEach((h, idx) => {
      if (identityIndexes.has(idx)) return;
      if (h === null || h === undefined || String(h).trim() === "") return;
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
        continue;

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
