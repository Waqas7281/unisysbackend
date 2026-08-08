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
import { Semester } from "./semester.entity";
import { User } from "./user.entity";

export enum ApplicationStatus {
  PENDING = "Pending",
  ASSIGNED = "Assigned",
  UNDER_REVIEW = "UnderReview",
  ACCEPTED = "Accepted",
  REJECTED = "Rejected",
}

@Entity({ tableName: "applications" })
@Index({ properties: ["student"] })
export class Application {
  @PrimaryKey()
  id: string = randomUUID();

  @ManyToOne(() => Student)
  student!: Student;

  @ManyToOne(() => Semester)
  semester!: Semester;

  @Property()
  title!: string;

  @Property({ type: "text", nullable: true })
  description?: string;

  @ManyToOne(() => User)
  createdBy!: User;

  @Enum(() => ApplicationStatus)
  status: ApplicationStatus = ApplicationStatus.PENDING;

  @ManyToOne(() => User, { nullable: true })
  assignedTo?: User;

  @Property({ nullable: true })
  assignedRole?: string;

  @Property({ default: false })
  locked: boolean = false; // locked once a reviewer touches it (Data Entry can no longer edit)

  @Property({ nullable: true })
  decisionReason?: string;

  @Property({ nullable: true })
  decidedAt?: Date;

  @Property({ type: "text", nullable: true, lazy: true })
  photoData?: string;

  @Property({ nullable: true })
  photoMimeType?: string;

  @Property({ onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date;
}
