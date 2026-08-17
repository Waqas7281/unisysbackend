import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { EntityRepository } from "@mikro-orm/postgresql";
import { InjectRepository } from "@mikro-orm/nestjs";
import {
  Application,
  ApplicationAction,
  ApplicationStatus,
  Semester,
  Student,
  User,
  UserRole,
} from "../../entities";
import { NotificationsService } from "../notifications/notifications.service";
import { MailerService } from "../mailer/mailer.service";
import { FeesService } from "../fees/fees.service";

// Proof photo cap for applications — 800KB, matches the client-side
// compression target in CreateApplication.jsx. Enforced again here since
// the client is never fully trusted.
const MAX_PHOTO_BYTES = 800 * 1024;

const REVIEWING_ROLES = [
  UserRole.MANAGER,
  UserRole.ACCOUNTS_MANAGER,
  UserRole.STUDENT_AFFAIR,
  UserRole.REGISTRAR,
];

@Injectable()
export class ApplicationsService {
  constructor(
    @InjectRepository(Application)
    private appRepo: EntityRepository<Application>,
    @InjectRepository(ApplicationAction)
    private actionRepo: EntityRepository<ApplicationAction>,
    @InjectRepository(Student) private studentRepo: EntityRepository<Student>,
    @InjectRepository(Semester)
    private semesterRepo: EntityRepository<Semester>,
    @InjectRepository(User) private userRepo: EntityRepository<User>,
    private notifications: NotificationsService,
    private mailer: MailerService,
    private feesService: FeesService,
  ) {}

  // JWT se aane wale plain {id, email, role, name} object ko
  // asli MikroORM User reference mein convert karta hai (DB hit ke bagair).
  private userRef(user: { id: string }): User {
    return this.appRepo.getEntityManager().getReference(User, user.id);
  }

  findAll(
    search?: string,
    createdByUserId?: string,
    assignedToUserId?: string,
  ) {
    const where: any = {};
    if (search) where.student = { enrollmentNumber: { $ilike: `%${search}%` } };
    if (createdByUserId) where.createdBy = createdByUserId;
    if (assignedToUserId) where.assignedTo = assignedToUserId;
    return this.appRepo.find(where, {
      orderBy: { createdAt: "DESC" },
      populate: ["student", "semester", "createdBy", "assignedTo"],
    });
  }
  findPending() {
    return this.appRepo.find(
      {
        status: {
          $in: [
            ApplicationStatus.PENDING,
            ApplicationStatus.ASSIGNED,
            ApplicationStatus.UNDER_REVIEW,
          ],
        },
      },
      {
        orderBy: { createdAt: "DESC" },
        populate: ["student", "semester", "createdBy", "assignedTo"],
      },
    );
  }

  async findOne(id: string) {
    const app = await this.appRepo.findOne(
      { id },
      {
        populate: [
          "student",
          "semester",
          "createdBy",
          "assignedTo",
          "photoData",
        ],
      },
    );
    if (!app) throw new NotFoundException("Application not found");
    const actions = await this.actionRepo.find(
      { application: id },
      { orderBy: { createdAt: "ASC" }, populate: ["performedBy"] },
    );
    return { application: app, actions };
  }

  /** 6.2 / 8.2: Data Entry creates an application only for an existing student, tied to one of their semesters. */
  async create(
    data: {
      enrollmentNumber: string;
      semesterId: string;
      title: string;
      description?: string;
      photoBase64?: string;
      photoMimeType?: string;
    },
    createdByUser: User,
  ) {
    const student = await this.studentRepo.findOne({
      enrollmentNumber: { $ilike: String(data.enrollmentNumber || "").trim() },
    });
    if (!student) {
      throw new BadRequestException(
        "Student not found for this Roll Number — application creation blocked",
      );
    }

    const semester = await this.semesterRepo.findOne({
      id: data.semesterId,
      student: student.id,
    });
    if (!semester) {
      throw new BadRequestException(
        "Selected semester does not belong to this student",
      );
    }

    let photoData: string | undefined;
    let photoMimeType: string | undefined;
    if (data.photoBase64) {
      const commaIdx = data.photoBase64.indexOf(",");
      const raw =
        data.photoBase64.startsWith("data:") && commaIdx !== -1
          ? data.photoBase64.slice(commaIdx + 1)
          : data.photoBase64;

      const approxBytes = Math.floor((raw.length * 3) / 4);
      if (approxBytes > MAX_PHOTO_BYTES) {
        throw new BadRequestException(
          "Proof photo is too large — please keep it under 800KB",
        );
      }

      photoData = raw;
      photoMimeType = data.photoMimeType || "image/jpeg";
    }

    const app = this.appRepo.create({
      student,
      semester,
      title: data.title,
      description: data.description,
      photoData,
      photoMimeType,
      createdBy: this.userRef(createdByUser),
      status: ApplicationStatus.PENDING,
    });
    await this.appRepo.getEntityManager().persistAndFlush(app);

    await this.notifications.notifyRoles(
      REVIEWING_ROLES,
      "ApplicationCreated",
      `New application "${app.title}" created for ${student.name} (${student.enrollmentNumber}) — ${semester.label}`,
      "Application",
      app.id,
    );

    return app;
  }

  async updatePhoto(
    applicationId: string,
    data: { photoBase64?: string | null; photoMimeType?: string },
    actingUser: User,
  ) {
    const app = await this.appRepo.findOneOrFail({ id: applicationId });
    await this.assertEditable(app, actingUser);

    if (data.photoBase64 === null) {
      app.photoData = undefined;
      app.photoMimeType = undefined;
    } else if (data.photoBase64) {
      const commaIdx = data.photoBase64.indexOf(",");
      const raw =
        data.photoBase64.startsWith("data:") && commaIdx !== -1
          ? data.photoBase64.slice(commaIdx + 1)
          : data.photoBase64;

      const approxBytes = Math.floor((raw.length * 3) / 4);
      if (approxBytes > MAX_PHOTO_BYTES) {
        throw new BadRequestException(
          "Proof photo is too large — please keep it under 800KB",
        );
      }

      app.photoData = raw;
      app.photoMimeType = data.photoMimeType || "image/jpeg";
    }

    await this.appRepo.getEntityManager().flush();
    return app;
  }

  private assertEditable(app: Application, actingUser: User) {
    if (actingUser.role === UserRole.DATA_ENTRY) {
      if (app.locked) {
        throw new ForbiddenException(
          "This application is locked — a reviewer has already acted on it",
        );
      }
    }
  }

  private assertCanReview(app: Application, actingUser: User) {
    const baseReviewerRoles = [
      UserRole.MANAGER,
      UserRole.ACCOUNTS_MANAGER,
      UserRole.STUDENT_AFFAIR,
      UserRole.REGISTRAR,
    ];
    if (app.assignedTo) {
      if (app.assignedTo.id !== actingUser.id) {
        throw new ForbiddenException(
          "This application is assigned to someone else — only the assignee can act on it",
        );
      }
      return;
    }
    if (!baseReviewerRoles.includes(actingUser.role)) {
      throw new ForbiddenException(
        "This application hasn't been assigned to you yet",
      );
    }
  }

  async addAction(
    applicationId: string,
    data: {
      actionType: string;
      title?: string;
      description?: string;
      amount?: number;
      date?: Date;
    },
    actingUser: User,
  ) {
    const app = await this.appRepo.findOneOrFail(
      { id: applicationId },
      { populate: ["student", "semester", "createdBy", "assignedTo"] },
    );
    await this.assertEditable(app, actingUser);
    if (actingUser.role !== UserRole.DATA_ENTRY) {
      this.assertCanReview(app, actingUser);
    }

    const action = this.actionRepo.create({
      application: app,
      performedBy: this.userRef(actingUser),
      performedByRole: actingUser.role,
      actionType: data.actionType,
      title: data.title,
      description: data.description,
      amount: data.amount !== undefined ? String(data.amount) : undefined,
      date: data.date,
    });
    await this.actionRepo.getEntityManager().persistAndFlush(action);

    if (REVIEWING_ROLES.includes(actingUser.role) && !app.locked) {
      app.locked = true;
      if (app.status === ApplicationStatus.PENDING)
        app.status = ApplicationStatus.UNDER_REVIEW;
      await this.appRepo.getEntityManager().flush();
    }

    if (data.amount !== undefined && data.amount > 0) {
      await this.feesService.postApplicationFine(
        app.student.id,
        app.semester.id,
        data.actionType,
        data.amount,
        data.title,
        actingUser,
      );
    }

    return action;
  }

  async updateAction(
    actionId: string,
    data: Partial<{
      title: string;
      description: string;
      amount: number;
      date: Date;
    }>,
    actingUser: User,
  ) {
    const original = await this.actionRepo.findOneOrFail(
      { id: actionId },
      { populate: ["application", "application.student"] },
    );
    const edit = this.actionRepo.create({
      application: original.application,
      performedBy: this.userRef(actingUser),
      performedByRole: actingUser.role,
      actionType: original.actionType,
      title: data.title ?? original.title,
      description: data.description ?? original.description,
      amount: data.amount !== undefined ? String(data.amount) : original.amount,
      date: data.date ?? original.date,
      originalActionId: original.id,
    });
    await this.actionRepo.getEntityManager().persistAndFlush(edit);
    return edit;
  }

  async deleteAction(actionId: string, actingUser: User) {
    const original = await this.actionRepo.findOneOrFail(
      { id: actionId },
      { populate: ["application"] },
    );
    const marker = this.actionRepo.create({
      application: original.application,
      performedBy: this.userRef(actingUser),
      performedByRole: actingUser.role,
      actionType: original.actionType,
      title: original.title,
      description: `[DELETED] ${original.description || ""}`.trim(),
      amount: original.amount,
      date: original.date,
      originalActionId: original.id,
      isDeleted: true,
    });
    await this.actionRepo.getEntityManager().persistAndFlush(marker);
    return marker;
  }

  async assign(
    applicationId: string,
    assignedToUserId: string,
    assignedRole: string,
  ) {
    const app = await this.appRepo.findOneOrFail(
      { id: applicationId },
      { populate: ["student"] },
    );
    const assignee = await this.userRepo.findOneOrFail({
      id: assignedToUserId,
    });
    app.assignedTo = assignee;
    app.assignedRole = assignedRole;
    app.status = ApplicationStatus.ASSIGNED;
    app.locked = true;
    await this.appRepo.getEntityManager().flush();

    await this.notifications.notify(
      assignee.id,
      "Assigned",
      `Application "${app.title}" for ${app.student.name} has been assigned to you`,
      "Application",
      app.id,
    );
    return app;
  }

  async markDone(applicationId: string, actingUser: User) {
    const app = await this.appRepo.findOneOrFail(
      { id: applicationId },
      { populate: ["student"] },
    );
    app.status = ApplicationStatus.UNDER_REVIEW;
    await this.appRepo.getEntityManager().flush();

    await this.notifications.notifyRoles(
      [UserRole.MANAGER],
      "ReviewReady",
      `${actingUser.name} marked "${app.title}" done — ready for your review`,
      "Application",
      app.id,
    );
    return app;
  }

  async decide(
    applicationId: string,
    decision: "Accepted" | "Rejected",
    reason: string | undefined,
    actingUser: User,
  ) {
    const app = await this.appRepo.findOneOrFail(
      { id: applicationId },
      { populate: ["student", "createdBy", "assignedTo"] },
    );
    this.assertCanReview(app, actingUser);

    app.status =
      decision === "Accepted"
        ? ApplicationStatus.ACCEPTED
        : ApplicationStatus.REJECTED;
    app.decisionReason = reason;
    app.decidedAt = new Date();
    await this.appRepo.getEntityManager().flush();

    await this.actionRepo.getEntityManager().persistAndFlush(
      this.actionRepo.create({
        application: app,
        performedBy: this.userRef(actingUser),
        performedByRole: actingUser.role,
        actionType: "Decision",
        title: decision,
        description: reason,
        date: new Date(),
      }),
    );

    if (app.student.email) {
      await this.mailer.send({
        to: app.student.email,
        subject: `Your application "${app.title}" has been ${decision}`,
        html: `<p>Dear ${app.student.name},</p>
               <p>Your application reference <b>${app.id}</b> ("${app.title}") has been <b>${decision}</b> as of ${app.decidedAt.toDateString()}.</p>
               ${reason ? `<p>Reason: ${reason}</p>` : ""}
               <p>Regards,<br/>University Administration</p>`,
      });
    }

    await this.notifications.notify(
      app.createdBy.id,
      "Decided",
      `Application "${app.title}" for ${app.student.name} was ${decision}`,
      "Application",
      app.id,
    );

    if (
      actingUser.role !== UserRole.MANAGER &&
      actingUser.role !== UserRole.REGISTRAR
    ) {
      await this.notifications.notifyRoles(
        [UserRole.MANAGER, UserRole.REGISTRAR],
        "Decided",
        `Application "${app.title}" for ${app.student.name} was ${decision} by ${actingUser.name} (${actingUser.role})${reason ? ` — "${reason}"` : ""}`,
        "Application",
        app.id,
      );
    }

    return app;
  }

  async fineTotalsForStudent(studentId: string) {
    const apps = await this.appRepo.find({ student: studentId });
    const appIds = apps.map((a) => a.id);
    if (appIds.length === 0) return { grandTotal: 0, byType: {} };

    const actions = await this.actionRepo.find({
      application: { $in: appIds },
      isDeleted: false,
      amount: { $ne: null },
    });

    const byType: Record<string, number> = {};
    let grandTotal = 0;
    for (const a of actions) {
      const amt = Number(a.amount || 0);
      byType[a.actionType] = (byType[a.actionType] || 0) + amt;
      grandTotal += amt;
    }
    return { grandTotal, byType };
  }
}
