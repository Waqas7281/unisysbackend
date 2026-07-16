import { Entity, PrimaryKey, Property, ManyToOne, Index } from '@mikro-orm/core';
import { randomUUID } from 'crypto';
import { Student } from './student.entity';
import { User } from './user.entity';

// Tracks any official letter a student has taken/collected from Record Room
// (e.g. Character Certificate, Bonafide Letter, Migration Letter, etc.)
// so Record Room staff can see at a glance what a student has already been issued.
@Entity({ tableName: 'letters' })
@Index({ properties: ['student'] })
export class Letter {
  @PrimaryKey()
  id: string = randomUUID();

  @ManyToOne(() => Student)
  student!: Student;

  @Property()
  title!: string;

  @Property({ type: 'text', nullable: true })
  description?: string;

  @Property({ onCreate: () => new Date() })
  issuedDate: Date = new Date();

  @ManyToOne(() => User, { nullable: true })
  issuedBy?: User;

  @Property({ onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date;
}
