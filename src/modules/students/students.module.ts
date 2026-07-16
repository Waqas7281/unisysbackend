import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Student,CustomFieldDefinition } from '../../entities';
import { StudentsService } from './students.service';
import { StudentsController } from './students.controller';

@Module({
  imports: [MikroOrmModule.forFeature([Student, CustomFieldDefinition])],
  controllers: [StudentsController],
  providers: [StudentsService],
  exports: [StudentsService],
})
export class StudentsModule {}
