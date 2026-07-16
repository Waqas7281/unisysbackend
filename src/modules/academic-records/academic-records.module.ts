import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { AcademicRecord, Student, User } from '../../entities';
import { AcademicRecordsService } from './academic-records.service';
import { AcademicRecordsController } from './academic-records.controller';

@Module({
  imports: [MikroOrmModule.forFeature([AcademicRecord, Student, User])],
  controllers: [AcademicRecordsController],
  providers: [AcademicRecordsService],
})
export class AcademicRecordsModule {}
