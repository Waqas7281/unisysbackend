import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityRepository } from '@mikro-orm/postgresql';
import { InjectRepository } from '@mikro-orm/nestjs';
import { Letter, Student, User } from '../../entities';

@Injectable()
export class LettersService {
  constructor(
    @InjectRepository(Letter) private letterRepo: EntityRepository<Letter>,
    @InjectRepository(Student) private studentRepo: EntityRepository<Student>,
  ) {}

  findByStudentId(studentId: string) {
    return this.letterRepo.find(
      { student: { id: studentId } },
      { populate: ['issuedBy'], orderBy: { issuedDate: 'DESC' } },
    );
  }

  async create(
    data: { studentId: string; title: string; description?: string },
    issuedBy: User,
  ) {
    const student = await this.studentRepo.findOne({ id: data.studentId });
    if (!student) throw new NotFoundException('Student not found');

    // MikroORM validates required fields on related entities.
    // Jwt payloads / CurrentUser can be partial, so avoid persisting an
    // incomplete User instance as `issuedBy`.
    //
    // If passwordHash is missing on the provided issuedBy object,
    // re-fetch the full entity.
    let issuer: User | undefined = issuedBy as any;
    if (!issuer?.id) {
      throw new Error('Invalid issuedBy user');
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
    return letter;
  }

  async update(id: string, data: Partial<{ title: string; description: string }>) {
    const letter = await this.letterRepo.findOne({ id });
    if (!letter) throw new NotFoundException('Letter not found');
    Object.assign(letter, data);
    await this.letterRepo.getEntityManager().flush();
    return letter;
  }

  async remove(id: string) {
    const letter = await this.letterRepo.findOneOrFail({ id });
    await this.letterRepo.getEntityManager().removeAndFlush(letter);
    return { message: 'Letter record deleted' };
  }
}
