import {
  Entity,
  PrimaryKey,
  Property,
  ManyToOne,
  Index,
  Unique,
} from '@mikro-orm/core';
import { randomUUID } from 'crypto';
import { Student } from './student.entity';
import { User } from './user.entity';

/**
 * A generated exam clearance slip. The `token` is a long random string (NOT
 * the roll number itself) that gets encoded into the slip's QR code — this is
 * the "unique phrase" the Manager asked for: it can't be guessed or hand-made
 * by a student, since verification only trusts a token that actually exists
 * in this table. Scanning it up looks up this row, confirms it hasn't expired,
 * and enforces the "once per day" rule via lastScannedDate.
 */
@Entity({ tableName: 'clearance_slips' })
export class ClearanceSlip {
  @PrimaryKey()
  id: string = randomUUID();

  @ManyToOne(() => Student, { deleteRule: 'cascade' })
  student!: Student;

  @Property()
  @Unique()
  @Index()
  token!: string;

  // e.g. "Final Term Spring-2026" — shown on the slip exactly as typed by the
  // Accounts Manager when generating it.
  @Property()
  term!: string;

  // Hex color, e.g. "#f5a623" — lets the Accounts Manager pick the slip's
  // background color at generation time.
  @Property({ nullable: true })
  backgroundColor?: string;

  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  issuedBy?: User;

  @Property({ onCreate: () => new Date() })
  issuedAt: Date = new Date();

  // issuedAt + 10 days. After this, verification always reports "expired" and
  // the row becomes eligible for automatic cleanup.
  @Property()
  expiresAt!: Date;

  // Date-only string (YYYY-MM-DD), the last calendar day this slip was
  // successfully scanned. Used to allow exactly one verified scan per day.
  @Property({ nullable: true })
  lastScannedDate?: string;

  @Property({ default: 0 })
  scanCount: number = 0;
}