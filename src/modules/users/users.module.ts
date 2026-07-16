import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { User } from '../../entities';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { MailerModule } from '../mailer/mailer.module';

@Module({
  imports: [MikroOrmModule.forFeature([User]), MailerModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
