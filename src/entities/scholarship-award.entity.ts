import {
  Entity,
  PrimaryKey,
  Property,
  ManyToOne,
  Unique,
} from "@mikro-orm/core";
import { randomUUID } from "crypto";
import { Student } from "./student.entity";
import { User } from "./user.entity";

// Acceptance letter ki shartein: har student ki SIRF EK row.
@Entity({ tableName: "scholarship_awards" })
@Unique({ properties: ["student"] })
export class ScholarshipAward {
  @PrimaryKey()
  id: string = randomUUID();

  @ManyToOne(() => Student, { deleteRule: "cascade" })
  student!: Student;

  // e.g. 20 (matlab 20%)
  @Property({ type: "decimal", precision: 5, scale: 2, default: 0 })
  percent: string = "0";

  // e.g. 3.00 (jo CGPA maintain karna hai)
  @Property({ type: "decimal", precision: 4, scale: 2, nullable: true })
  maintainedCgpa?: string;

  @ManyToOne(() => User, { nullable: true })
  updatedBy?: User;

  @Property({ onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date;
}
