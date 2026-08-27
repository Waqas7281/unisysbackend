import {
  Entity,
  PrimaryKey,
  Property,
  ManyToOne,
  Index,
} from "@mikro-orm/core";
import { randomUUID } from "crypto";
import { Application } from "./application.entity";
import { Student } from "./student.entity";
import { User } from "./user.entity";

// A saved, serial-numbered slip. A row is only created the moment someone
// actually clicks "Print Slip" (see SlipsController#create / ApplicationDetail
// handlePrintSlip) — never on preview — so every serialNumber printed on
// paper corresponds to a real row here that can later be searched up.
@Entity({ tableName: "slips" })
export class Slip {
  @PrimaryKey()
  id: string = randomUUID();

  // Postgres SERIAL column — DB-generated, unique, safe under concurrent
  // prints (two Data Entry users printing at the same instant can't collide).
  // This is the number printed on the slip and the number staff search by.
  @Property({ columnType: "serial", unique: true })
  @Index()
  serialNumber!: number;

  @ManyToOne(() => Application, { nullable: true, deleteRule: "set null" })
  application?: Application;

  @ManyToOne(() => Student, { nullable: true, deleteRule: "set null" })
  student?: Student;

  @Property()
  title!: string; // slip template title, e.g. "Late Fee Fine", "Degree"...

  @Property()
  sessionType!: string; // Fall | Spring | Summer

  @Property()
  sessionYear!: string;

  @Property({ nullable: true })
  rollNo?: string;

  @Property({ nullable: true })
  program?: string;

  @Property({ type: "decimal", precision: 12, scale: 2, nullable: true })
  amount?: string;

  @Property({ nullable: true })
  preparedBy?: string; // name as typed on the slip at print time

  @ManyToOne(() => User, { nullable: true, deleteRule: "set null" })
  issuedBy?: User;

  // dsa / totalAbsents / courses / detail — the hand-typed fields that
  // don't exist anywhere else in the system, frozen at print time.
  @Property({ type: "json", nullable: true })
  extra?: Record<string, string>;

  @Property({ onCreate: () => new Date() })
  issuedAt: Date = new Date();
}
