import { Injectable, NotFoundException } from "@nestjs/common";
import { EntityRepository } from "@mikro-orm/postgresql";
import { InjectRepository } from "@mikro-orm/nestjs";
import { Letter, Student, User } from "../../entities";
import { AuditService } from "../audit/audit.service";

@Injectable()
export class LettersService {
  constructor(
    @InjectRepository(Letter) private letterRepo: EntityRepository<Letter>,
    @InjectRepository(Student) private studentRepo: EntityRepository<Student>,
    private auditService: AuditService,
  ) {}

  findByStudentId(studentId: string) {
    return this.letterRepo.find(
      { student: { id: studentId } },
      { populate: ["issuedBy"], orderBy: { issuedDate: "DESC" } },
    );
  }

  async create(
    data: { studentId: string; title: string; description?: string },
    issuedBy: User,
  ) {
    const student = await this.studentRepo.findOne({ id: data.studentId });
    if (!student) throw new NotFoundException("Student not found");

    let issuer: User | undefined = issuedBy as any;
    if (!issuer?.id) {
      throw new Error("Invalid issuedBy user");
    }

    if (!(issuer as any).passwordHash) {
      issuer = await this.letterRepo
        .getEntityManager()
        .findOne(User, { id: issuer.id });
    }

    const letter = this.letterRepo.create({
      student,
      title: data.title,
      description: data.description,
      issuedBy: issuer,
    });
    await this.letterRepo.getEntityManager().persistAndFlush(letter);

    await this.auditService.log({
      module: "Letter",
      action: "Created",
      studentId: student.id,
      recordId: letter.id,
      actingUser: { id: issuer!.id, role: (issuer as any).role },
      description: `Issued letter "${data.title}" to ${student.name} (${student.enrollmentNumber})${data.description ? ` — "${data.description}"` : ""}`,
    });
    return letter;
  }

  async update(
    id: string,
    data: Partial<{ title: string; description: string }>,
    actingUser?: { id: string; role: string },
  ) {
    const letter = await this.letterRepo.findOne(
      { id },
      { populate: ["student"] },
    );
    if (!letter) throw new NotFoundException("Letter not found");

    const changes: Record<string, { from: any; to: any }> = {};
    if (data.title !== undefined && data.title !== letter.title) {
      changes.title = { from: letter.title, to: data.title };
    }
    if (
      data.description !== undefined &&
      data.description !== letter.description
    ) {
      changes.description = { from: letter.description, to: data.description };
    }

    Object.assign(letter, data);
    await this.letterRepo.getEntityManager().flush();

    if (actingUser?.id && Object.keys(changes).length) {
      await this.auditService.log({
        module: "Letter",
        action: "Updated",
        studentId: letter.student.id,
        recordId: letter.id,
        actingUser,
        description: `Updated letter "${letter.title}" for ${letter.student.name} (${letter.student.enrollmentNumber})${data.description ? ` — new text: "${data.description}"` : ""}`,
        changes,
      });
    }
    return letter;
  }

  async remove(id: string, actingUser?: { id: string; role: string }) {
    const letter = await this.letterRepo.findOneOrFail(
      { id },
      { populate: ["student"] },
    );
    const summary = `"${letter.title}" for ${letter.student.name} (${letter.student.enrollmentNumber})`;
    await this.letterRepo.getEntityManager().removeAndFlush(letter);
    if (actingUser?.id) {
      await this.auditService.log({
        module: "Letter",
        action: "Deleted",
        recordId: id,
        actingUser,
        description: `Deleted letter ${summary}`,
      });
    }
    return { message: "Letter record deleted" };
  }
}
