import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Letter, Student, User } from '../../entities';
import { LettersService } from './letters.service';
import { LettersController } from './letters.controller';

@Module({
  imports: [MikroOrmModule.forFeature([Letter, Student, User])],
  controllers: [LettersController],
  providers: [LettersService],
})
export class LettersModule {}
