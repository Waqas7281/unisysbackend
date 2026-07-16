import { Entity, PrimaryKey, Property, Enum } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

export enum SemesterSystem {
  FOUR_YEAR = '4-year',
  FIVE_YEAR = '5-year',
}

// NewAdmission = registered by the Admission Center, still being completed by Record Room.
// Continuing = an already-studying student whose academic record Record Room maintains.
export enum StudentCategory {
  NEW_ADMISSION = 'NewAdmission',
  CONTINUING = 'Continuing',
}

@Entity({ tableName: 'students' })
export class Student {
  @PrimaryKey()
  id: string = randomUUID();

  @Property({ unique: true })
  enrollmentNumber!: string;

  // Assigned by the Admission Center at initial registration time.
  @Property({ nullable: true, unique: true })
  registrationId?: string;

  @Property()
  name!: string;

  @Property({ nullable: true })
  fatherName?: string;

  @Property({ nullable: true })
  cnic?: string;

  @Property({ nullable: true })
  rollNo?: string;

  @Property({ nullable: true })
  section?: string;

  @Property({ nullable: true })
  program?: string;

  @Enum({ items: () => SemesterSystem, nullable: true })
  semesterSystem?: SemesterSystem;

  // Exact program length in years, derived automatically from the Fee Excel's
  // "Adm Session" + "Degree Years" columns (see FeesService.importExcel /
  // SemestersService.generateFromAdmission). Takes priority over the coarser
  // semesterSystem enum (4-year/5-year) when set, since real programs can be
  // 2-year, 3-year, etc. — not just those two options.
  @Property({ nullable: true })
  programDurationYears?: number;

  @Property({ nullable: true })
  email?: string;

  // --- Basic Matric details (captured at admission; result/marks live in AcademicRecord) ---
  @Property({ nullable: true })
  matricBoard?: string;

  @Property({ nullable: true })
  matricRollNo?: string;

  @Property({ nullable: true })
  matricYear?: number;

  // --- Basic Intermediate details (result/marks live in AcademicRecord) ---
  @Property({ nullable: true })
  interBoard?: string;

  @Property({ nullable: true })
  interRollNo?: string;

  @Property({ nullable: true })
  interYear?: number;

  @Enum({ items: () => StudentCategory, default: StudentCategory.CONTINUING })
  studentCategory: StudentCategory = StudentCategory.CONTINUING;

  // JSONB store for admin-defined custom fields (see CustomFieldDefinition)
  @Property({ type: 'json', nullable: true })
  customFields?: Record<string, any> = {};

  @Property({ nullable: true })
  createdBy?: string;

  @Property({ onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date;
}
