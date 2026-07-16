import { Injectable } from '@nestjs/common';
import { EntityRepository } from '@mikro-orm/postgresql';
import { InjectRepository } from '@mikro-orm/nestjs';
import { Application, ApplicationStatus, Fee, Student } from '../../entities';

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Student) private studentRepo: EntityRepository<Student>,
    @InjectRepository(Fee) private feeRepo: EntityRepository<Fee>,
    @InjectRepository(Application) private appRepo: EntityRepository<Application>,
  ) {}

  async summary() {
    const totalStudents = await this.studentRepo.count();
    const paidStudentIds = await this.feeRepo
      .getEntityManager()
      .getConnection()
      .execute(`SELECT DISTINCT student_id FROM fees WHERE paid_status = 'paid'`);
    const unpaidStudentIds = await this.feeRepo
      .getEntityManager()
      .getConnection()
      .execute(`SELECT DISTINCT student_id FROM fees WHERE paid_status != 'paid'`);
    const totalPendingApplications = await this.appRepo.count({
      status: { $in: [ApplicationStatus.PENDING, ApplicationStatus.ASSIGNED, ApplicationStatus.UNDER_REVIEW] },
    });

    return {
      totalStudents,
      studentsWithFeePaid: paidStudentIds.length,
      studentsWithFeeUnpaid: unpaidStudentIds.length,
      totalPendingApplications,
    };
  }
}
