import {
  Entity,
  PrimaryKey,
  Property,
  ManyToOne,
  Unique,
  Index,
} from "@mikro-orm/core";
import { randomUUID } from "crypto";
import { Student } from "./student.entity";
import { Semester } from "./semester.entity";
import { User } from "./user.entity";

// Har student + har semester (session) ki ek row: us semester ka CGPA
// aur ye ke drop ka farq Fee page mein post ho chuka hai ya nahi.
@Entity({ tableName: "scholarship_records" })
@Unique({ properties: ["student", "semester"] })
@Index({ properties: ["semester"] })
export class ScholarshipRecord {
  @PrimaryKey()
  id: string = randomUUID();

  @ManyToOne(() => Student, { deleteRule: "cascade" })
  student!: Student;

  @ManyToOne(() => Semester, { deleteRule: "cascade" })
  semester!: Semester;

  @Property({ type: "decimal", precision: 4, scale: 2, nullable: true })
  currentCgpa?: string;

  // 0 matlab abhi Fee page mein post nahi hua
  @Property({ type: "decimal", precision: 12, scale: 2, default: 0 })
  postedAmount: string = "0";

  @Property({ nullable: true })
  postedAt?: Date;

  @ManyToOne(() => User, { nullable: true })
  postedBy?: User;

  @Property({ onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date;
}
