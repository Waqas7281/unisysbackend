import { Entity, PrimaryKey, Property, Enum } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

export enum UserRole {
  MANAGER = 'Manager',
  ACCOUNTS_MANAGER = 'AccountsManager',
  STUDENT_AFFAIR = 'StudentAffair',
  DATA_ENTRY = 'DataEntry',
  RECORD_ROOM = 'RecordRoom',
  REGISTRAR = 'Registrar',
  ADMISSION_CENTER = 'AdmissionCenter',
  HR = 'HR',
}

@Entity({ tableName: 'users' })
export class User {
  @PrimaryKey()
  id: string = randomUUID();

  @Property()
  name!: string;

  @Property({ unique: true })
  email!: string;

  @Property({ hidden: true })
  passwordHash!: string;

  @Enum(() => UserRole)
  role!: UserRole;

  @Property({ default: true })
  isActive: boolean = true;

  @Property({ onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date;
}
