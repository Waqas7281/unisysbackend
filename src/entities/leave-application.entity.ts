import {
  Entity,
  PrimaryKey,
  Property,
  ManyToOne,
  Enum,
  Index,
} from "@mikro-orm/core";
import { randomUUID } from "crypto";
import { User } from "./user.entity";
import { Student } from "./student.entity";

export enum LeaveStatus {
  PENDING = "Pending",
  APPROVED = "Approved",
  REJECTED = "Rejected",
}

@Entity({ tableName: "leave_applications" })
@Index({ properties: ["student"] })
export class LeaveApplication {
  @PrimaryKey()
  id: string = randomUUID();

  // Jis student ki leave hai
  @ManyToOne(() => Student)
  student!: Student;

  // Jis ne application create ki (Record Room / Manager / Registrar)
  @ManyToOne(() => User)
  createdBy!: User;

  // Apni marzi ka title
  @Property()
  title!: string;

  // 'YYYY-MM-DD' string (date column)
  @Property({ type: "date" })
  fromDate!: string;

  @Property({ type: "date" })
  toDate!: string;

  // Maange gaye din
  @Property()
  days!: number;

  // Approve karne wale ne jitne din diye
  @Property({ nullable: true })
  approvedDays?: number;

  @Property({ type: "text" })
  reason!: string;

  @Enum(() => LeaveStatus)
  status: LeaveStatus = LeaveStatus.PENDING;

  @ManyToOne(() => User, { nullable: true })
  decidedBy?: User;

  @Property({ nullable: true })
  decidedByRole?: string;

  @Property({ nullable: true })
  decidedOn?: Date;

  @Property({ type: "text", nullable: true })
  remarks?: string;

  @Property({ onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date;
}
