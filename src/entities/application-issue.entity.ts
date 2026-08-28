import {
  Entity,
  PrimaryKey,
  Property,
  ManyToOne,
  Index,
} from "@mikro-orm/core";
import { randomUUID } from "crypto";
import { Application } from "./application.entity";
import { User } from "./user.entity";

// A blocking remark raised on an application by whoever currently holds it.
// While ANY issue on an application is unresolved, ApplicationsService
// #acceptStage refuses to accept the current stage — forces the problem to
// be sorted out (e.g. Data Entry fixing something) before the workflow can
// continue. Visible to every department viewing the application, like the
// Audit Trail.
@Entity({ tableName: "application_issues" })
@Index({ properties: ["application"] })
export class ApplicationIssue {
  @PrimaryKey()
  id: string = randomUUID();

  @ManyToOne(() => Application)
  application!: Application;

  @Property({ type: "text" })
  message!: string;

  @ManyToOne(() => User)
  raisedBy!: User;

  @Property()
  raisedByRole!: string;

  @Property({ onCreate: () => new Date() })
  raisedAt: Date = new Date();

  @Property({ default: false })
  resolved: boolean = false;

  @ManyToOne(() => User, { nullable: true })
  resolvedBy?: User;

  @Property({ nullable: true })
  resolvedAt?: Date;
}
