import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Staff, StaffApplication, StaffLeave } from '../../entities';
import { HrService } from './hr.service';
import { HrController } from './hr.controller';

@Module({
  imports: [MikroOrmModule.forFeature([Staff, StaffApplication, StaffLeave])],
  controllers: [HrController],
  providers: [HrService],
})
export class HrModule {}
