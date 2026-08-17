import { Module } from "@nestjs/common";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import { AcademicRecord, Student, User } from "../../entities";
import { AcademicRecordsService } from "./academic-records.service";
import { AcademicRecordsController } from "./academic-records.controller";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [
    MikroOrmModule.forFeature([AcademicRecord, Student, User]),
    AuditModule,
  ],
  controllers: [AcademicRecordsController],
  providers: [AcademicRecordsService],
})
export class AcademicRecordsModule {}
