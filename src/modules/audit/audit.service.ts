import { Injectable } from "@nestjs/common";
import { EntityRepository } from "@mikro-orm/postgresql";
import { InjectRepository } from "@mikro-orm/nestjs";
import { AuditLog, User } from "../../entities";

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private auditRepo: EntityRepository<AuditLog>,
  ) {}

  private userRef(user: { id: string }): User {
    return this.auditRepo.getEntityManager().getReference(User, user.id);
  }

  async log(entry: {
    module: string;
    action: string;
    studentId?: string;
    recordId?: string;
    actingUser: { id: string; role: string };
    description: string;
    changes?: Record<string, { from: any; to: any }>;
  }) {
    const log = this.auditRepo.create({
      module: entry.module,
      action: entry.action,
      student: entry.studentId ? ({ id: entry.studentId } as any) : undefined,
      recordId: entry.recordId,
      performedBy: this.userRef(entry.actingUser),
      performedByRole: entry.actingUser.role,
      description: entry.description,
      changes: entry.changes,
    });
    await this.auditRepo.getEntityManager().persistAndFlush(log);
    return log;
  }

  findAll(filters: {
    studentId?: string;
    performedByUserId?: string;
    module?: string;
  }) {
    const where: any = {};
    if (filters.studentId) where.student = filters.studentId;
    if (filters.performedByUserId)
      where.performedBy = filters.performedByUserId;
    if (filters.module) where.module = filters.module;
    return this.auditRepo.find(where, {
      orderBy: { createdAt: "DESC" },
      populate: ["performedBy", "student"],
      limit: 500,
    });
  }
}
