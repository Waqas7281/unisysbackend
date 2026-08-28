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
  ApplicationAssignment,
  ApplicationIssue,
  ApplicationStatus,
  Semester,
  Student,
  User,
  UserRole,
} from "../../entities";
import { NotificationsService } from "../notifications/notifications.service";
import { MailerService } from "../mailer/mailer.service";
import { FeesService } from "../fees/fees.service";

const MAX_PHOTO_BYTES = 800 * 1024;

const REVIEWING_ROLES = [
  UserRole.MANAGER,
  UserRole.ACCOUNTS_MANAGER,
  UserRole.STUDENT_AFFAIR,
  UserRole.REGISTRAR,
];

const BASE_REVIEWER_ROLES = [
  UserRole.MANAGER,
  UserRole.ACCOUNTS_MANAGER,
  UserRole.STUDENT_AFFAIR,
  UserRole.REGISTRAR,
];

const MAX_STAGES = 3;

@Injectable()
export class ApplicationsService {
  constructor(
    @InjectRepository(Application)
    private appRepo: EntityRepository<Application>,
    @InjectRepository(ApplicationAction)
    private actionRepo: EntityRepository<ApplicationAction>,
    @InjectRepository(ApplicationAssignment)
    private assignmentRepo: EntityRepository<ApplicationAssignment>,
    @InjectRepository(ApplicationIssue)
    private issueRepo: EntityRepository<ApplicationIssue>,
    @InjectRepository(Student) private studentRepo: EntityRepository<Student>,
    @InjectRepository(Semester)
    private semesterRepo: EntityRepository<Semester>,
    @InjectRepository(User) private userRepo: EntityRepository<User>,
    private notifications: NotificationsService,
    private mailer: MailerService,
    private feesService: FeesService,
  ) {}

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

  private getAssignments(applicationId: string) {
    return this.assignmentRepo.find(
      { application: applicationId },
      { orderBy: { stage: "ASC" }, populate: ["assignedTo", "assignedBy"] },
    );
  }

  private getIssues(applicationId: string) {
    return this.issueRepo.find(
      { application: applicationId },
      {
        orderBy: { raisedAt: "DESC" },
        populate: ["raisedBy", "resolvedBy"],
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
    const assignments = await this.getAssignments(id);
    const issues = await this.getIssues(id);
    return { application: app, actions, assignments, issues };
  }

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
    this.assertEditable(app, actingUser);

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

  private async assertCanReview(app: Application, actingUser: User) {
    const allAssignments = await this.getAssignments(app.id);
    if (allAssignments.length > 0) {
      const current = allAssignments.find((r) => !r.accepted);
      if (!current || current.assignedTo.id !== actingUser.id) {
        throw new ForbiddenException(
          "This application is assigned to someone else at the current stage — only the assignee can act on it",
        );
      }
      return;
    }
    if (!BASE_REVIEWER_ROLES.includes(actingUser.role)) {
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
    this.assertEditable(app, actingUser);
    if (actingUser.role !== UserRole.DATA_ENTRY) {
      await this.assertCanReview(app, actingUser);
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

  async assignStage(
    applicationId: string,
    stage: number,
    assignedToUserId: string,
    assignedRole: string,
    actingUser: User,
  ) {
    if (![1, 2, 3].includes(stage)) {
      throw new BadRequestException("Stage must be 1, 2 or 3");
    }
    const app = await this.appRepo.findOneOrFail(
      { id: applicationId },
      { populate: ["student"] },
    );

    const existing = await this.getAssignments(applicationId);

    if (stage > 1) {
      const prev = existing.find((a) => a.stage === stage - 1);
      if (!prev || !prev.accepted) {
        throw new BadRequestException(
          `Stage ${stage - 1} must be accepted before assigning stage ${stage}`,
        );
      }
    }

    let row = existing.find((a) => a.stage === stage);
    if (row?.accepted) {
      throw new BadRequestException(
        "This stage has already been accepted and can't be reassigned",
      );
    }

    const assignee = await this.userRepo.findOneOrFail({
      id: assignedToUserId,
    });
    const em = this.appRepo.getEntityManager();

    if (row) {
      row.assignedTo = assignee;
      row.assignedRole = assignedRole;
      row.assignedBy = this.userRef(actingUser);
      row.assignedAt = new Date();
    } else {
      row = this.assignmentRepo.create({
        application: app,
        stage,
        assignedTo: assignee,
        assignedRole,
        assignedBy: this.userRef(actingUser),
        accepted: false,
      });
    }
    em.persist(row);

    app.assignedTo = assignee;
    app.assignedRole = assignedRole;
    app.status = ApplicationStatus.ASSIGNED;
    app.locked = true;
    await em.flush();

    await this.notifications.notify(
      assignee.id,
      "Assigned",
      `Application "${app.title}" for ${app.student.name} has been assigned to you (stage ${stage} of ${MAX_STAGES})`,
      "Application",
      app.id,
    );

    return this.getAssignments(applicationId);
  }

  async acceptStage(applicationId: string, actingUser: User) {
    const app = await this.appRepo.findOneOrFail(
      { id: applicationId },
      { populate: ["student", "createdBy"] },
    );

    const allAssignments = await this.getAssignments(applicationId);
    const current = allAssignments.find((a) => !a.accepted);
    if (!current) {
      throw new BadRequestException("There is no active stage to accept");
    }
    if (current.assignedTo.id !== actingUser.id) {
      throw new ForbiddenException(
        "This stage is assigned to someone else — only the assignee can accept it",
      );
    }

    const openIssues = await this.issueRepo.find({
      application: applicationId,
      resolved: false,
    });
    if (openIssues.length > 0) {
      throw new BadRequestException(
        "This application has an unresolved issue — it must be cleared before this stage can be accepted",
      );
    }

    current.accepted = true;
    current.acceptedAt = new Date();
    const em = this.appRepo.getEntityManager();
    await em.persistAndFlush(current);

    await this.actionRepo.getEntityManager().persistAndFlush(
      this.actionRepo.create({
        application: app,
        performedBy: this.userRef(actingUser),
        performedByRole: actingUser.role,
        actionType: "StageAccepted",
        title: `Stage ${current.stage} accepted`,
        description: current.assignedRole,
        date: new Date(),
      }),
    );

    if (current.stage >= MAX_STAGES) {
      app.status = ApplicationStatus.ACCEPTED;
      app.decidedAt = new Date();
      await em.flush();

      if (app.student.email) {
        await this.mailer.send({
          to: app.student.email,
          subject: `Your application "${app.title}" has been Accepted`,
          html: `<p>Dear ${app.student.name},</p>
                 <p>Your application reference <b>${app.id}</b> ("${app.title}") has been <b>Accepted</b> as of ${app.decidedAt.toDateString()}.</p>
                 <p>Regards,<br/>University Administration</p>`,
        });
      }
      await this.notifications.notify(
        app.createdBy.id,
        "Decided",
        `Application "${app.title}" for ${app.student.name} was Accepted`,
        "Application",
        app.id,
      );
    } else {
      app.status = ApplicationStatus.UNDER_REVIEW;
      await em.flush();
      await this.notifications.notifyRoles(
        [UserRole.MANAGER, UserRole.REGISTRAR],
        "ReviewReady",
        `Stage ${current.stage} of "${app.title}" accepted by ${actingUser.name} — ready to assign the next department`,
        "Application",
        app.id,
      );
    }

    return this.getAssignments(applicationId);
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

  async raiseIssue(applicationId: string, message: string, actingUser: User) {
    const trimmed = (message || "").trim();
    if (!trimmed) {
      throw new BadRequestException("Issue message can't be empty");
    }
    const app = await this.appRepo.findOneOrFail({ id: applicationId });
    await this.assertCanReview(app, actingUser);

    const issue = this.issueRepo.create({
      application: app,
      message: trimmed,
      raisedBy: this.userRef(actingUser),
      raisedByRole: actingUser.role,
      resolved: false,
    });
    await this.issueRepo.getEntityManager().persistAndFlush(issue);

    await this.notifications.notifyRoles(
      REVIEWING_ROLES,
      "IssueRaised",
      `Issue raised on "${app.title}" by ${actingUser.name} (${actingUser.role}): ${trimmed}`,
      "Application",
      app.id,
    );

    return this.getIssues(applicationId);
  }

  async resolveIssue(issueId: string, actingUser: User) {
    const issue = await this.issueRepo.findOneOrFail(
      { id: issueId },
      { populate: ["application"] },
    );
    if (issue.resolved) {
      throw new BadRequestException("This issue is already resolved");
    }
    await this.assertCanReview(issue.application, actingUser);

    issue.resolved = true;
    issue.resolvedBy = this.userRef(actingUser);
    issue.resolvedAt = new Date();
    await this.issueRepo.getEntityManager().persistAndFlush(issue);

    return this.getIssues(issue.application.id);
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
    await this.assertCanReview(app, actingUser);

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
