import { Injectable, NotFoundException } from "@nestjs/common";
import { EntityRepository } from "@mikro-orm/postgresql";
import { InjectRepository } from "@mikro-orm/nestjs";
import { Slip, Application, Student, User } from "../../entities";

@Injectable()
export class SlipsService {
  constructor(
    @InjectRepository(Slip) private slipRepo: EntityRepository<Slip>,
  ) {}

  async create(
    data: {
      applicationId?: string;
      studentId?: string;
      title: string;
      sessionType: string;
      sessionYear: string | number;
      rollNo?: string;
      program?: string;
      amount?: number | string;
      preparedBy?: string;
      extra?: Record<string, string>;
    },
    issuedByUser: User,
  ) {
    const em = this.slipRepo.getEntityManager();

    // MikroORM validates entity fields before insert and doesn't know this
    // column is DB-generated (Postgres "serial"), so we pull the next
    // sequence value ourselves first — pg_get_serial_sequence looks up the
    // actual sequence backing the column, no name-guessing involved, and
    // nextval() is atomic so concurrent prints can never collide.
    const [{ nextval }] = await em
      .getConnection()
      .execute(
        `select nextval(pg_get_serial_sequence('slips', 'serial_number')) as nextval`,
      );

    const slip = this.slipRepo.create({
      serialNumber: Number(nextval),
      application: data.applicationId
        ? em.getReference(Application, data.applicationId)
        : undefined,
      student: data.studentId
        ? em.getReference(Student, data.studentId)
        : undefined,
      title: data.title,
      sessionType: data.sessionType,
      sessionYear: String(data.sessionYear),
      rollNo: data.rollNo,
      program: data.program,
      amount:
        data.amount !== undefined && data.amount !== ""
          ? String(data.amount)
          : undefined,
      preparedBy: data.preparedBy,
      issuedBy: em.getReference(User, issuedByUser.id),
      extra: data.extra,
    });
    await em.persistAndFlush(slip);
    return slip;
  }

  async findBySerial(serialNumber: number) {
    if (!serialNumber || Number.isNaN(serialNumber)) {
      throw new NotFoundException("Invalid serial number");
    }
    const slip = await this.slipRepo.findOne(
      { serialNumber },
      { populate: ["application", "student", "issuedBy"] },
    );
    if (!slip) {
      throw new NotFoundException("No slip found with this serial number");
    }
    return slip;
  }
}
