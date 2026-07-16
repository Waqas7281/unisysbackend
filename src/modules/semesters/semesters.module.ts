import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Semester, Student } from '../../entities';
import { SemestersService } from './semesters.service';
import { SemestersController } from './semesters.controller';

@Module({
  imports: [MikroOrmModule.forFeature([Semester, Student])],
  controllers: [SemestersController],
  providers: [SemestersService],
  exports: [SemestersService],
})
export class SemestersModule {}
