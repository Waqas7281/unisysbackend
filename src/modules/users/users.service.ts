import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityRepository } from '@mikro-orm/postgresql';
import { InjectRepository } from '@mikro-orm/nestjs';
import * as bcrypt from 'bcrypt';
import { User, UserRole } from '../../entities';
import { MailerService } from '../mailer/mailer.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private userRepo: EntityRepository<User>,
    private mailer: MailerService,
  ) {}

  findAll() {
    return this.userRepo.findAll({ orderBy: { createdAt: 'DESC' } });
  }

  async create(data: { name: string; email: string; password: string; role: UserRole }) {
    const existing = await this.userRepo.findOne({ email: data.email.toLowerCase() });
    if (existing) throw new BadRequestException('A user with this email already exists');

    const passwordHash = await bcrypt.hash(data.password, 10);
    const user = this.userRepo.create({
      name: data.name,
      email: data.email.toLowerCase(),
      passwordHash,
      role: data.role,
    });
    await this.userRepo.getEntityManager().persistAndFlush(user);

    await this.mailer.send({
      to: user.email,
      subject: 'Your University System account has been created',
      html: `<p>Hello ${user.name},</p><p>An account has been created for you as <b>${user.role}</b>. You can now log in using this email address.</p>`,
    });

    return user;
  }

  async update(id: string, data: Partial<{ name: string; email: string; role: UserRole }>) {
    // passwordHash is marked as hidden in the entity; explicitly fetch it so flush() doesn't
    // fail with: Value for User.passwordHash is required, undefined found.
    const user = await this.userRepo.findOne({ id }, { fields: ['passwordHash', 'name', 'email', 'role', 'isActive', 'createdAt', 'updatedAt'] } as any);
    if (!user) throw new NotFoundException('User not found');
    if (data.name) user.name = data.name;
    if (data.email) user.email = data.email.toLowerCase();
    if (data.role) user.role = data.role;
    await this.userRepo.getEntityManager().flush();
    return user;
  }


  async remove(id: string) {
    const user = await this.userRepo.findOne({ id });
    if (!user) throw new NotFoundException('User not found');
    await this.userRepo.getEntityManager().removeAndFlush(user);
    return { message: 'User deleted' };
  }


  async toggleBlock(id: string) {
    const user = await this.userRepo.findOne({ id }, { fields: ['passwordHash', 'name', 'email', 'role', 'isActive', 'createdAt', 'updatedAt'] } as any);

    if (!user) throw new NotFoundException('User not found');
    user.isActive = !user.isActive;
    await this.userRepo.getEntityManager().flush();

    await this.mailer.send({
      to: user.email,
      subject: user.isActive ? 'Your account has been unblocked' : 'Your account has been blocked',
      html: `<p>Hello ${user.name},</p><p>Your account status has changed: <b>${user.isActive ? 'Active' : 'Blocked'}</b>.</p>`,
    });

    return user;
  }
}
