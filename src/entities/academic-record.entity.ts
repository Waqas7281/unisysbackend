import {
  Entity,
  PrimaryKey,
  Property,
  ManyToOne,
  Enum,
  Index,
} from "@mikro-orm/core";
import { randomUUID } from "crypto";
import { Student } from "./student.entity";
import { User } from "./user.entity";

export const AcademicLevelValues = {
  MATRIC: "Matric",
  INTERMEDIATE: "Intermediate",
  DEGREE: "Degree",
} as const;

export type AcademicLevel =
  (typeof AcademicLevelValues)[keyof typeof AcademicLevelValues];

@Entity({ tableName: "academic_records" })
@Index({ properties: ["student"] })
export class AcademicRecord {
  @PrimaryKey()
  id: string = randomUUID();

  @ManyToOne(() => Student)
  student!: Student;

  @Enum(() => AcademicLevelValues)
  level!: AcademicLevel;

  @Property({ nullable: true })
  sessionStartYear?: number;

  @Property({ nullable: true })
  sessionEndYear?: number;

  @Property({ nullable: true })
  totalMarks?: number;

  @Property({ nullable: true })
  obtainedMarks?: number;

  @ManyToOne(() => User, { nullable: true })
  enteredBy?: User;

  @Property({ onCreate: () => new Date() })
  createdAt: Date = new Date();
}
