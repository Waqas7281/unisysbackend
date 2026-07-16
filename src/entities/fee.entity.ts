import { Entity, PrimaryKey, Property, ManyToOne, Index } from '@mikro-orm/core';
import { randomUUID } from 'crypto';
import { Student } from './student.entity';
import { Semester } from './semester.entity';

@Entity({ tableName: "fees" })
@Index({ properties: ["student"] })
export class Fee {
  @PrimaryKey()
  id: string = randomUUID();

  @ManyToOne(() => Student, { deleteRule: "cascade" })
  student!: Student;

  @ManyToOne(() => Semester, { deleteRule: "cascade" })
  semester!: Semester;

  @Property()
  feeType!: string; // registration | tuition | capstone | custom:<name>

  @Property({ type: "decimal", precision: 12, scale: 2, default: 0 })
  amount: string = "0";

  @Property({ default: 1 })
  installmentNumber: number = 1;

  @Property({ nullable: true })
  dueDate?: Date;

  @Property({ nullable: true })
  lastFeeDate?: Date;

  @Property({ default: "unpaid" })
  paidStatus: string = "unpaid"; // unpaid | partial | paid

  @Property({ type: "decimal", precision: 12, scale: 2, default: 0 })
  paidAmount: string = "0";

  // Arbitrary custom fee columns (dynamic schema, EAV-lite via JSONB)
  @Property({ type: "json", nullable: true })
  customValues?: Record<string, any> = {};

  // Status tabs
  @Property({ default: false })
  drop: boolean = false;

  @Property({ default: false })
  dpt: boolean = false;

  @Property({ default: false })
  bar: boolean = false;

  @Property({ default: false })
  cancel: boolean = false;

  @Property({ default: false })
  dropOfScholarship: boolean = false;

  @Property({ onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date;
}
