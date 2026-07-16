import { Entity, PrimaryKey, Property, ManyToOne, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';
import { Staff } from './staff.entity';

// One row per staff per month — how many "off" days that staff member took that month.
@Entity({ tableName: 'staff_leaves' })
@Unique({ properties: ['staff', 'month', 'year'] })
export class StaffLeave {
  @PrimaryKey()
  id: string = randomUUID();

  @ManyToOne(() => Staff)
  staff!: Staff;

  // 1-12
  @Property()
  month!: number;

  @Property()
  year!: number;

  @Property({ default: 0 })
  offDays: number = 0;

  @Property({ type: 'text', nullable: true })
  note?: string;

  @Property({ onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date;
}
