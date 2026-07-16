import { Entity, PrimaryKey, Property, ManyToOne, Index } from '@mikro-orm/core';
import { randomUUID } from 'crypto';
import { Application } from './application.entity';
import { User } from './user.entity';

// Append-only audit trail entry. Edits/deletes create new rows referencing originalActionId.
@Entity({ tableName: 'application_actions' })
@Index({ properties: ['application'] })
export class ApplicationAction {
  @PrimaryKey()
  id: string = randomUUID();

  @ManyToOne(() => Application)
  application!: Application;

  @ManyToOne(() => User)
  performedBy!: User;

  @Property()
  performedByRole!: string;

  @Property()
  actionType!: string; // Fine | DC | UMC | LateFee | DPT | Bar | Cancel | DropScholarship | Custom | StatusChange | Assign | Decision

  @Property({ nullable: true })
  title?: string;

  @Property({ type: 'text', nullable: true })
  description?: string;

  @Property({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  amount?: string;

  @Property({ nullable: true })
  date?: Date;

  @Property({ nullable: true })
  originalActionId?: string; // set when this row is an edit/delete-marker of a prior entry

  @Property({ default: false })
  isDeleted: boolean = false;

  @Property({ onCreate: () => new Date() })
  createdAt: Date = new Date();
}
