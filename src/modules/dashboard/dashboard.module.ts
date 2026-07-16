import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Application, Fee, Student } from '../../entities';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';

@Module({
  imports: [MikroOrmModule.forFeature([Student, Fee, Application])],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
