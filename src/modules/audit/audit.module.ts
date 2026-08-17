import { Module } from "@nestjs/common";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import { AuditLog } from "../../entities";
import { AuditService } from "./audit.service";
import { AuditController } from "./audit.controller";

@Module({
  imports: [MikroOrmModule.forFeature([AuditLog])],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
