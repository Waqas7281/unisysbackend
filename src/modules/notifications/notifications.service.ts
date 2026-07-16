import { Injectable } from '@nestjs/common';
import { EntityRepository } from '@mikro-orm/postgresql';
import { InjectRepository } from '@mikro-orm/nestjs';
import { Notification, User } from '../../entities';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification) private notifRepo: EntityRepository<Notification>,
    @InjectRepository(User) private userRepo: EntityRepository<User>,
  ) {}

  async notify(recipientId: string, type: string, message: string, referenceType?: string, referenceId?: string) {
    const recipient = await this.userRepo.findOne({ id: recipientId });
    if (!recipient) return;
    const notif = this.notifRepo.create({ recipient, type, message, referenceType, referenceId });
    await this.notifRepo.getEntityManager().persistAndFlush(notif);
    return notif;
  }

  async notifyRoles(roles: string[], type: string, message: string, referenceType?: string, referenceId?: string) {
    const users = await this.userRepo.find({ role: { $in: roles as any }, isActive: true });
    for (const u of users) {
      await this.notify(u.id, type, message, referenceType, referenceId);
    }
  }

  findForUser(userId: string) {
    return this.notifRepo.find({ recipient: userId }, { orderBy: { createdAt: 'DESC' }, limit: 100 });
  }

  async markRead(id: string) {
    const notif = await this.notifRepo.findOneOrFail({ id });
    notif.isRead = true;
    await this.notifRepo.getEntityManager().flush();
    return notif;
  }

  async markAllRead(userId: string) {
    const notifs = await this.notifRepo.find({ recipient: userId, isRead: false });
    notifs.forEach((n) => (n.isRead = true));
    await this.notifRepo.getEntityManager().flush();
    return { message: 'All notifications marked as read' };
  }

  unreadCount(userId: string) {
    return this.notifRepo.count({ recipient: userId, isRead: false });
  }
}
