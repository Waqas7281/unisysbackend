import { Module } from "@nestjs/common";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import {
  Application,
  ApplicationAction,
  Semester,
  Student,
  User,
} from "../../entities";
import { ApplicationsService } from "./applications.service";
import { ApplicationsController } from "./applications.controller";
import { NotificationsModule } from "../notifications/notifications.module";
import { MailerModule } from "../mailer/mailer.module";
import { FeesModule } from "../fees/fees.module";

@Module({
  imports: [
    MikroOrmModule.forFeature([
      Application,
      ApplicationAction,
      Student,
      Semester,
      User,
    ]),
    NotificationsModule,
    MailerModule,
    FeesModule,
  ],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}
