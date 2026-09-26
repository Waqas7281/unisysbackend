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
      // "Prepared By" = whoever is actually printing/saving this slip right
      // now, NOT whoever originally typed the fine/action entry. Taken from
      // the authenticated request user (server-side, can't be spoofed by
      // whatever the frontend sends) so it always matches who clicked Print.
      preparedBy: issuedByUser.name,
      issuedBy: em.getReference(User, issuedByUser.id),
      extra: data.extra,
    });
    await em.persistAndFlush(slip);
    // Populate issuedBy (name + role) before returning so the frontend can
    // show "Printed by: <role>" immediately, without a second lookup.
    await em.populate(slip, ["issuedBy"]);
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

  // Powers the "Recent Slips" list + Enrollment/Name/Type filters on the
  // Search Slip page — this is how a lost/misplaced slip is FOUND again
  // (so staff re-print the same serial instead of accidentally generating
  // a brand new one for the same fine/fee).
  async search(params: {
    enrollmentNumber?: string;
    name?: string;
    title?: string;
    page?: number | string;
    limit?: number | string;
  }) {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(params.limit) || 10));

    const and: any[] = [];
    if (params.enrollmentNumber) {
      and.push({
        $or: [
          { rollNo: { $ilike: `%${params.enrollmentNumber}%` } },
          {
            student: {
              enrollmentNumber: { $ilike: `%${params.enrollmentNumber}%` },
            },
          },
        ],
      });
    }
    if (params.name) {
      and.push({ student: { name: { $ilike: `%${params.name}%` } } });
    }
    if (params.title) {
      and.push({ title: { $ilike: `%${params.title}%` } });
    }

    const where: any = and.length ? { $and: and } : {};

    const [items, total] = await this.slipRepo.findAndCount(where, {
      orderBy: { issuedAt: "DESC" },
      populate: ["student", "issuedBy"],
      limit,
      offset: (page - 1) * limit,
    });

    return { items, total, page, limit };
  }
}
