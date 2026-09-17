import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';
import { User } from '../../entities';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectRepository(User) private userRepo: EntityRepository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET') || 'change_this_super_secret_key',
    });
  }

  async validate(payload: any) {
    // Token signature/expiry check pehle Passport khud kar chuka hai —
    // ab yahan har request pe database se dobara confirm karte hain ke
    // user abhi bhi maujood aur active hai. Isi wajah se block karte hi
    // user ka agla API call turant reject ho jata hai, uska purana token
    // expire hone ka intezar nahi karna parta.
    const user = await this.userRepo.findOne({ id: payload.sub });

    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('unauthorized');
    }

    return { id: user.id, email: user.email, role: user.role, name: user.name };
  }
}import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';
import { User } from '../../entities';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectRepository(User) private userRepo: EntityRepository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET') || 'change_this_super_secret_key',
    });
  }

  async validate(payload: any) {
    // Token signature/expiry check pehle Passport khud kar chuka hai —
    // ab yahan har request pe database se dobara confirm karte hain ke
    // user abhi bhi maujood aur active hai. Isi wajah se block karte hi
    // user ka agla API call turant reject ho jata hai, uska purana token
    // expire hone ka intezar nahi karna parta.
    const user = await this.userRepo.findOne({ id: payload.sub });

    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('unauthorized');
    }

    return { id: user.id, email: user.email, role: user.role, name: user.name };
  }
}