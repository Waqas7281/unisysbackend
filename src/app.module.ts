import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import mikroOrmConfig from './mikro-orm.config';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { StudentsModule } from './modules/students/students.module';
import { SemestersModule } from './modules/semesters/semesters.module';
import { FeesModule } from './modules/fees/fees.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AcademicRecordsModule } from './modules/academic-records/academic-records.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { MailerModule } from './modules/mailer/mailer.module';
import { LettersModule } from './modules/letters/letters.module';
import { HrModule } from './modules/hr/hr.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 1 minute window
        limit: 100, // max 100 requests per IP per minute
      },
    ]),
    MikroOrmModule.forRoot(mikroOrmConfig),
    AuthModule,
    UsersModule,
    StudentsModule,
    SemestersModule,
    FeesModule,
    ApplicationsModule,
    NotificationsModule,
    AcademicRecordsModule,
    DashboardModule,
    MailerModule,
    LettersModule,
    HrModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
