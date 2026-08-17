import { Module } from "@nestjs/common";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import { CustomFieldDefinition, Fee, Semester, Student } from "../../entities";
import { FeesService } from "./fees.service";
import { FeesController } from "./fees.controller";
import { NotificationsModule } from "../notifications/notifications.module";
import { SemestersModule } from "../semesters/semesters.module";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [
    MikroOrmModule.forFeature([Fee, Semester, Student, CustomFieldDefinition]),
    NotificationsModule,
    SemestersModule,
    AuditModule,
  ],
  controllers: [FeesController],
  providers: [FeesService],
  exports: [FeesService],
})
export class FeesModule {}
