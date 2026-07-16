import { Entity, PrimaryKey, Property, Enum, ManyToOne, Index } from '@mikro-orm/core';
import { randomUUID } from 'crypto';
import { Student } from './student.entity';

export enum SemesterType {
  FALL = 'Fall',
  SPRING = 'Spring',
}

@Entity({ tableName: "semesters" })
@Index({ properties: ["student"] })
export class Semester {
  @PrimaryKey()
  id: string = randomUUID();

  @ManyToOne(() => Student, { deleteRule: "cascade" })
  student!: Student;

  @Property()
  label!: string; // e.g. "Fall 2019"

  @Enum(() => SemesterType)
  type!: SemesterType;

  @Property()
  year!: number;

  @Property()
  order!: number; // sequence order for display

  @Property({ onCreate: () => new Date() })
  createdAt: Date = new Date();
}
