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

// One row per assignment stage (1, 2 or 3) an application goes through.
// Stage N+1 can only be created once stage N is accepted — enforced in
// ApplicationsService#assignStage, not here.
@Entity({ tableName: "application_assignments" })
@Index({ properties: ["application"] })
export class ApplicationAssignment {
  @PrimaryKey()
  id: string = randomUUID();

  @ManyToOne(() => Application)
  application!: Application;

  @Property()
  stage!: number; // 1, 2 or 3

  @ManyToOne(() => User)
  assignedTo!: User;

  @Property()
  assignedRole!: string;

  @ManyToOne(() => User)
  assignedBy!: User;

  @Property({ onCreate: () => new Date() })
  assignedAt: Date = new Date();

  @Property({ default: false })
  accepted: boolean = false;

  @Property({ nullable: true })
  acceptedAt?: Date;
}
