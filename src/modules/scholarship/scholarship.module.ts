import { Module } from "@nestjs/common";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import {
  CustomFieldDefinition,
  Fee,
  ScholarshipAward,
  ScholarshipRecord,
  Semester,
  Student,
} from "../../entities";
import { ScholarshipService } from "./scholarship.service";
import { ScholarshipController } from "./scholarship.controller";
import { FeesModule } from "../fees/fees.module";
import { SemestersModule } from "../semesters/semesters.module";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [
    MikroOrmModule.forFeature([
      ScholarshipAward,
      ScholarshipRecord,
      Fee,
      Semester,
      Student,
      CustomFieldDefinition,
    ]),
    FeesModule,
    SemestersModule,
    AuditModule,
  ],
  controllers: [ScholarshipController],
  providers: [ScholarshipService],
})
export class ScholarshipModule {}
