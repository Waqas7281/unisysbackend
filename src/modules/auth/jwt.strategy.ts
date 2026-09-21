import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@mikro-orm/nestjs";
import { EntityRepository } from "@mikro-orm/postgresql";
import { User } from "../../entities";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectRepository(User) private userRepo: EntityRepository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get("JWT_SECRET") || "change_this_super_secret_key",
    });
  }

  // Har request par chalta hai. JWT stateless hota hai, isliye block hone ke baad
  // bhi valid rehta hai jab tak DB se check na karo.
  async validate(payload: any) {
    const em = this.userRepo.getEntityManager().fork();
    const user = await em.findOne(User, { id: payload.sub });

    if (!user) throw new UnauthorizedException("ACCOUNT_NOT_FOUND");
    if (!user.isActive) throw new UnauthorizedException("ACCOUNT_BLOCKED");

    return { id: user.id, email: user.email, role: user.role, name: user.name };
  }
}
