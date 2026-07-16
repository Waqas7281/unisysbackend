import { Entity, PrimaryKey, Property, Enum } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

export enum CustomFieldAppliesTo {
  FEE = 'Fee',
  STUDENT = 'Student',
}

@Entity({ tableName: 'custom_field_definitions' })
export class CustomFieldDefinition {
  @PrimaryKey()
  id: string = randomUUID();

  @Property()
  name!: string;

  @Enum(() => CustomFieldAppliesTo)
  appliesTo!: CustomFieldAppliesTo;

  @Property({ default: 'text' })
  dataType: string = 'text'; // text | number | date | boolean

  @Property({ nullable: true })
  columnOrder?: number;

  @Property({ nullable: true })
  createdByUserId?: string;

  @Property({ onCreate: () => new Date() })
  createdAt: Date = new Date();
}
