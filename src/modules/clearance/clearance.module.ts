import { Module } from "@nestjs/common";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import { ClearanceSlip, Student } from "../../entities";
import { ClearanceService } from "./clearance.service";
import { ClearanceController } from "./clearance.controller";
import { FeesModule } from "../fees/fees.module";

@Module({
  imports: [MikroOrmModule.forFeature([ClearanceSlip, Student]), FeesModule],
  controllers: [ClearanceController],
  providers: [ClearanceService],
})
export class ClearanceModule {}
