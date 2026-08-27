import { Module } from "@nestjs/common";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import { Slip } from "../../entities";
import { SlipsService } from "./slips.service";
import { SlipsController } from "./slips.controller";

@Module({
  imports: [MikroOrmModule.forFeature([Slip])],
  controllers: [SlipsController],
  providers: [SlipsService],
})
export class SlipsModule {}
