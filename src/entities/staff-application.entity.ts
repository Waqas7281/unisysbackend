import { Entity, PrimaryKey, Property, ManyToOne, Index } from '@mikro-orm/core';
import { randomUUID } from 'crypto';
import { Staff } from './staff.entity';

// An application/request filed by or about a staff member (leave request, complaint,
// warning, etc.) — grouped month-wise so HR can tell current-month vs older applications apart.
@Entity({ tableName: 'staff_applications' })
@Index({ properties: ['staff'] })
export class StaffApplication {
  @PrimaryKey()
  id: string = randomUUID();

  @ManyToOne(() => Staff)
  staff!: Staff;

  @Property()
  title!: string;

  @Property({ type: 'text', nullable: true })
  description?: string;

  // 1-12
  @Property()
  month!: number;

  @Property()
  year!: number;

  @Property({ nullable: true })
  createdBy?: string;

  @Property({ onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date;
}
