import { Entity, PrimaryKey, Property, Enum } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

export enum StaffStatus {
  ACTIVE = 'Active',
  LEFT = 'Left',
}

@Entity({ tableName: 'staff' })
export class Staff {
  @PrimaryKey()
  id: string = randomUUID();

  @Property()
  name!: string;

  @Property({ nullable: true })
  designation?: string;

  @Property({ nullable: true })
  department?: string;

  @Property({ nullable: true })
  contact?: string;

  @Property({ nullable: true })
  email?: string;

  @Property({ nullable: true })
  cnic?: string;

  @Enum(() => StaffStatus)
  status: StaffStatus = StaffStatus.ACTIVE;

  @Property({ nullable: true })
  joinDate?: Date;

  // Set when status is moved to Left
  @Property({ nullable: true })
  leftDate?: Date;

  @Property({ nullable: true })
  createdBy?: string;

  @Property({ onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date;
}
