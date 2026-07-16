import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { EntityRepository } from '@mikro-orm/postgresql';
import { InjectRepository } from '@mikro-orm/nestjs';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { User, UserRole } from '../../entities';
import { MailerService } from '../mailer/mailer.service';

@Injectable()
export class AuthService {
  private resetTokens = new Map<string, { userId: string; expires: number }>();

  constructor(
    @InjectRepository(User) private userRepo: EntityRepository<User>,
    private jwt: JwtService,
    private mailer: MailerService,
  ) {}

  async login(email: string, password: string, role: UserRole) {
    const user = await this.userRepo.findOne({ email: email.toLowerCase() });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (!user.isActive) throw new UnauthorizedException('Your account has been blocked. Contact the Manager.');
    if (user.role !== role) throw new UnauthorizedException('Selected role does not match this account');

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const token = this.jwt.sign({ sub: user.id, email: user.email, role: user.role, name: user.name });
    return {
      accessToken: token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    };
  }

  async forgotPassword(email: string) {
    const user = await this.userRepo.findOne({ email: email.toLowerCase() });
    // Always respond success to avoid leaking which emails exist
    if (!user) return { message: 'If that email exists, a reset link has been sent.' };

    const token = randomBytes(32).toString('hex');
    this.resetTokens.set(token, { userId: user.id, expires: Date.now() + 1000 * 60 * 30 });

    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${token}`;
    await this.mailer.send({
      to: user.email,
      subject: 'Password Reset - University System',
      html: `<p>Hello ${user.name},</p><p>Click the link below to reset your password. This link expires in 30 minutes.</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
    });

    return { message: 'If that email exists, a reset link has been sent.' };
  }

  async resetPassword(token: string, newPassword: string) {
    const entry = this.resetTokens.get(token);
    if (!entry || entry.expires < Date.now()) {
      throw new BadRequestException('Reset link is invalid or expired');
    }
    const user = await this.userRepo.findOneOrFail({ id: entry.userId });
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await this.userRepo.getEntityManager().persistAndFlush(user);
    this.resetTokens.delete(token);
    return { message: 'Password updated successfully' };
  }
}
