import {
  Entity,
  PrimaryKey,
  Property,
  ManyToOne,
  Index,
} from "@mikro-orm/core";
import { randomUUID } from "crypto";
import { Student } from "./student.entity";
import { User } from "./user.entity";

@Entity({ tableName: "audit_logs" })
@Index({ properties: ["student"] })
@Index({ properties: ["performedBy"] })
@Index({ properties: ["module"] })
export class AuditLog {
  @PrimaryKey()
  id: string = randomUUID();

  @Property()
  module!: string;

  @Property()
  action!: string;

  @ManyToOne(() => Student, { nullable: true, deleteRule: "cascade" })
  student?: Student;

  @Property({ nullable: true })
  recordId?: string;

  @ManyToOne(() => User)
  performedBy!: User;

  @Property()
  performedByRole!: string;

  @Property({ type: "text" })
  description!: string;

  @Property({ type: "json", nullable: true })
  changes?: Record<string, { from: any; to: any }>;

  @Property({ onCreate: () => new Date() })
  createdAt: Date = new Date();
}
