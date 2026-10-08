import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { EntityRepository } from "@mikro-orm/postgresql";
import { InjectRepository } from "@mikro-orm/nestjs";
import {
  LeaveApplication,
  LeaveStatus,
  Student,
  User,
  UserRole,
} from "../../entities";
import { NotificationsService } from "../notifications/notifications.service";

// Yeh teeno roles create bhi kar sakte hain aur approve / reject bhi
const APPROVER_ROLES = [
  UserRole.RECORD_ROOM,
  UserRole.MANAGER,
  UserRole.REGISTRAR,
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const POPULATE = ["student", "createdBy", "decidedBy"] as const;

const calcDays = (from: string, to: string) =>
  Math.floor((Date.parse(to) - Date.parse(from)) / 86400000) + 1;

@Injectable()
export class LeaveApplicationsService {
  constructor(
    @InjectRepository(LeaveApplication)
    private leaveRepo: EntityRepository<LeaveApplication>,
    @InjectRepository(Student) private studentRepo: EntityRepository<Student>,
    @InjectRepository(User) private userRepo: EntityRepository<User>,
    private notifications: NotificationsService,
  ) {}

  private userRef(id: string): User {
    return this.leaveRepo.getEntityManager().getReference(User, id);
  }

  private serialize(l: LeaveApplication) {
    return {
      id: l.id,
      studentId: l.student.id,
      studentName: l.student.name,
      enrollmentNumber: l.student.enrollmentNumber,
      program: l.student.program ?? null,
      createdById: l.createdBy.id,
      createdByName: l.createdBy.name,
      createdByRole: l.createdBy.role,
      title: l.title,
      fromDate: l.fromDate,
      toDate: l.toDate,
      days: l.days,
      approvedDays: l.approvedDays ?? null,
      reason: l.reason,
      status: l.status,
      appliedOn: l.createdAt.toISOString().slice(0, 10),
      decidedBy: l.decidedBy?.name ?? null,
      decidedByRole: l.decidedByRole ?? null,
      decidedOn: l.decidedOn ? l.decidedOn.toISOString().slice(0, 10) : null,
      remarks: l.remarks ?? null,
    };
  }

  // Student dhoondna: enrollment no / roll no / registration id se (partial, case-insensitive)
  async searchStudents(q: string) {
    const raw = (q || "").trim();
    if (!raw) return [];

    // ILIKE ke special characters escape
    const escaped = raw.replace(/[\\%_]/g, (c) => `\\${c}`);
    const pattern = `%${escaped}%`;

    const list = await this.studentRepo.find(
      {
        $or: [
          { enrollmentNumber: { $ilike: pattern } },
          { rollNo: { $ilike: pattern } },
          { registrationId: { $ilike: pattern } },
        ],
      },
      { limit: 20, orderBy: { enrollmentNumber: "ASC" } },
    );

    // Exact match (spaces / case ignore) sab se upar
    const norm = (s?: string | null) =>
      (s || "").replace(/\s+/g, "").toLowerCase();
    const key = norm(raw);
    const rank = (s: Student) =>
      [s.enrollmentNumber, s.rollNo, s.registrationId].some(
        (v) => norm(v) === key,
      )
        ? 0
        : 1;

    return list
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, 10)
      .map((s) => ({
        id: s.id,
        name: s.name,
        fatherName: s.fatherName ?? null,
        enrollmentNumber: s.enrollmentNumber,
        rollNo: s.rollNo ?? null,
        program: s.program ?? null,
        email: s.email ?? null,
      }));
  }

  async findAll() {
    const list = await this.leaveRepo.find(
      {},
      { populate: [...POPULATE], orderBy: { createdAt: "DESC" } },
    );
    return list.map((l) => this.serialize(l));
  }

  async findOne(id: string) {
    const leave = await this.leaveRepo.findOne(
      { id },
      { populate: [...POPULATE] },
    );
    if (!leave) throw new NotFoundException("Leave application not found");
    return this.serialize(leave);
  }

  async create(data: any, user: { id: string; name: string; role: string }) {
    // 1) Student DB mein mojud hona zaroori hai
    const studentId = typeof data?.studentId === "string" ? data.studentId : "";
    if (!studentId)
      throw new BadRequestException("Pehle student select karein");
    const student = await this.studentRepo.findOne({ id: studentId });
    if (!student)
      throw new NotFoundException("Student database mein mojud nahi hai");

    // 2) Title (free text)
    const title = typeof data?.title === "string" ? data.title.trim() : "";
    if (!title) throw new BadRequestException("Title likhna zaroori hai");
    if (title.length > 150) {
      throw new BadRequestException(
        "Title 150 characters se zyada nahi ho sakta",
      );
    }

    // 3) Dates
    if (
      !DATE_RE.test(data?.fromDate || "") ||
      !DATE_RE.test(data?.toDate || "")
    ) {
      throw new BadRequestException("From aur To date sahi format mein dein");
    }
    const days = calcDays(data.fromDate, data.toDate);
    if (!Number.isFinite(days) || days < 1) {
      throw new BadRequestException(
        "To date, From date se pehle nahi ho sakti",
      );
    }

    // 4) Reason
    const reason = typeof data.reason === "string" ? data.reason.trim() : "";
    if (!reason) throw new BadRequestException("Reason likhna zaroori hai");

    const leave = this.leaveRepo.create({
      student,
      createdBy: this.userRef(user.id),
      title,
      fromDate: data.fromDate,
      toDate: data.toDate,
      days,
      reason,
    });
    await this.leaveRepo.getEntityManager().persistAndFlush(leave);

    // Baaqi approvers ko notification (banane wale ko nahi)
    const approvers = await this.userRepo.find({
      role: { $in: APPROVER_ROLES },
      isActive: true,
      id: { $ne: user.id },
    });
    const message =
      `Leave application: ${student.name} (${student.enrollmentNumber}) — ${days} din, ${title}`.slice(
        0,
        250,
      );
    for (const u of approvers) {
      await this.notifications.notify(
        u.id,
        "LeaveApplied",
        message,
        "LeaveApplication",
        leave.id,
      );
    }

    return this.findOne(leave.id);
  }

  async decide(
    id: string,
    data: any,
    user: { id: string; name: string; role: string },
  ) {
    const leave = await this.leaveRepo.findOne(
      { id },
      { populate: ["student", "createdBy"] },
    );
    if (!leave) throw new NotFoundException("Leave application not found");
    if (leave.status !== LeaveStatus.PENDING) {
      throw new BadRequestException(
        "Yeh application pehle hi decide ho chuki hai",
      );
    }

    const status = data?.status;
    if (status !== LeaveStatus.APPROVED && status !== LeaveStatus.REJECTED) {
      throw new BadRequestException("Status Approved ya Rejected hona chahiye");
    }
    const remarks = typeof data.remarks === "string" ? data.remarks.trim() : "";

    if (status === LeaveStatus.APPROVED) {
      const n = Number(data.approvedDays);
      if (!Number.isInteger(n) || n < 1) {
        throw new BadRequestException(
          "Approved days likhna zaroori hai (kam az kam 1)",
        );
      }
      if (n > leave.days) {
        throw new BadRequestException(
          `Approved days requested days (${leave.days}) se zyada nahi ho sakte`,
        );
      }
      leave.approvedDays = n;
    } else if (!remarks) {
      throw new BadRequestException(
        "Reject karne par remarks likhna zaroori hai",
      );
    }

    leave.status = status;
    leave.remarks = remarks || undefined;
    leave.decidedBy = this.userRef(user.id);
    leave.decidedByRole = user.role;
    leave.decidedOn = new Date();
    await this.leaveRepo.getEntityManager().flush();

    // Application banane wale ko result ki notification (agar usne khud decide nahi kiya)
    if (leave.createdBy.id !== user.id) {
      const who = `${leave.student.name} (${leave.student.enrollmentNumber})`;
      const msg =
        status === LeaveStatus.APPROVED
          ? `${who} ki leave approve ho gayi — ${leave.approvedDays} din`
          : `${who} ki leave reject ho gayi`;
      await this.notifications.notify(
        leave.createdBy.id,
        "LeaveDecided",
        msg.slice(0, 250),
        "LeaveApplication",
        leave.id,
      );
    }

    return this.findOne(leave.id);
  }
}
