import { Entity, PrimaryKey, Property, ManyToOne, Index } from '@mikro-orm/core';
import { randomUUID } from 'crypto';
import { User } from './user.entity';

@Entity({ tableName: 'notifications' })
@Index({ properties: ['recipient'] })
export class Notification {
  @PrimaryKey()
  id: string = randomUUID();

  @ManyToOne(() => User)
  recipient!: User;

  @Property()
  type!: string; // ApplicationCreated | Assigned | ReviewReady | Decided | FeeUpdated | UserAccount | StatusChange

  @Property({ nullable: true })
  referenceType?: string; // Application | Student | User

  @Property({ nullable: true })
  referenceId?: string;

  @Property()
  message!: string;

  @Property({ default: false })
  isRead: boolean = false;

  @Property({ onCreate: () => new Date() })
  createdAt: Date = new Date();
}
