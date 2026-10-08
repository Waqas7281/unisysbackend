import { Module } from "@nestjs/common";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import { LeaveApplication, Student, User } from "../../entities";
import { LeaveApplicationsService } from "./leave-applications.service";
import { LeaveApplicationsController } from "./leave-applications.controller";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [
    MikroOrmModule.forFeature([LeaveApplication, Student, User]),
    NotificationsModule,
  ],
  controllers: [LeaveApplicationsController],
  providers: [LeaveApplicationsService],
})
export class LeaveApplicationsModule {}
