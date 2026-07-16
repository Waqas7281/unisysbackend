import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityRepository } from '@mikro-orm/postgresql';
import { InjectRepository } from '@mikro-orm/nestjs';
import { Staff, StaffApplication, StaffLeave, StaffStatus } from '../../entities';

@Injectable()
export class HrService {
  constructor(
    @InjectRepository(Staff) private staffRepo: EntityRepository<Staff>,
    @InjectRepository(StaffApplication)
    private appRepo: EntityRepository<StaffApplication>,
    @InjectRepository(StaffLeave) private leaveRepo: EntityRepository<StaffLeave>,
  ) {}

  // ---- Staff ----
  async findAllStaff(filters: { search?: string; status?: string }) {
    const where: any = {};
    if (filters.status) where.status = filters.status;
    if (filters.search) {
      const s = filters.search;
      where.$or = [
        { name: { $ilike: `%${s}%` } },
        { designation: { $ilike: `%${s}%` } },
        { department: { $ilike: `%${s}%` } },
        { contact: { $ilike: `%${s}%` } },
        { cnic: { $ilike: `%${s}%` } },
      ];
    }
    return this.staffRepo.find(where, { orderBy: { createdAt: 'DESC' } });
  }

  findOneStaff(id: string) {
    return this.staffRepo.findOneOrFail({ id });
  }

  async createStaff(data: any, createdBy: string) {
    const staff = this.staffRepo.create({
      name: data.name,
      designation: data.designation,
      department: data.department,
      contact: data.contact,
      email: data.email,
      cnic: data.cnic,
      joinDate: data.joinDate ? new Date(data.joinDate) : new Date(),
      status: StaffStatus.ACTIVE,
      createdBy,
    });
    await this.staffRepo.getEntityManager().persistAndFlush(staff);
    return staff;
  }

  async updateStaff(id: string, data: any) {
    const staff = await this.staffRepo.findOne({ id });
    if (!staff) throw new NotFoundException('Staff member not found');

    if (data.status && data.status !== staff.status) {
      staff.status = data.status;
      staff.leftDate = data.status === StaffStatus.LEFT ? new Date() : undefined;
    }
    if (data.name !== undefined) staff.name = data.name;
    if (data.designation !== undefined) staff.designation = data.designation;
    if (data.department !== undefined) staff.department = data.department;
    if (data.contact !== undefined) staff.contact = data.contact;
    if (data.email !== undefined) staff.email = data.email;
    if (data.cnic !== undefined) staff.cnic = data.cnic;
    if (data.joinDate !== undefined) staff.joinDate = data.joinDate ? new Date(data.joinDate) : undefined;

    await this.staffRepo.getEntityManager().flush();
    return staff;
  }

  async removeStaff(id: string) {
    const staff = await this.staffRepo.findOneOrFail({ id });
    await this.staffRepo.getEntityManager().removeAndFlush(staff);
    return { message: 'Staff member deleted' };
  }

  async dashboardSummary() {
    const total = await this.staffRepo.count();
    const active = await this.staffRepo.count({ status: StaffStatus.ACTIVE });
    const left = total - active;
    return { total, active, left };
  }

  // ---- Staff Applications ----
  async findApplicationsForStaff(staffId: string) {
    const apps = await this.appRepo.find(
      { staff: { id: staffId } },
      { orderBy: { year: 'DESC', month: 'DESC', createdAt: 'DESC' } },
    );
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const currentMonthApps = apps.filter(
      (a) => a.month === currentMonth && a.year === currentYear,
    );
    const olderApps = apps.filter(
      (a) => !(a.month === currentMonth && a.year === currentYear),
    );

    // Group older applications by "Month Year" for a clean month-wise view.
    const byMonth: Record<string, any[]> = {};
    for (const a of olderApps) {
      const key = `${a.year}-${String(a.month).padStart(2, '0')}`;
      if (!byMonth[key]) byMonth[key] = [];
      byMonth[key].push(a);
    }

    return { currentMonthApps, byMonth };
  }

  async createApplication(data: any, createdBy: string) {
    const staff = await this.staffRepo.findOne({ id: data.staffId });
    if (!staff) throw new NotFoundException('Staff member not found');

    const now = new Date();
    const app = this.appRepo.create({
      staff,
      title: data.title,
      description: data.description,
      month: data.month ? Number(data.month) : now.getMonth() + 1,
      year: data.year ? Number(data.year) : now.getFullYear(),
      createdBy,
    });
    await this.appRepo.getEntityManager().persistAndFlush(app);
    return app;
  }

  async updateApplication(id: string, data: any) {
    const app = await this.appRepo.findOne({ id });
    if (!app) throw new NotFoundException('Application not found');
    if (data.title !== undefined) app.title = data.title;
    if (data.description !== undefined) app.description = data.description;
    if (data.month !== undefined) app.month = Number(data.month);
    if (data.year !== undefined) app.year = Number(data.year);
    await this.appRepo.getEntityManager().flush();
    return app;
  }

  async removeApplication(id: string) {
    const app = await this.appRepo.findOneOrFail({ id });
    await this.appRepo.getEntityManager().removeAndFlush(app);
    return { message: 'Application deleted' };
  }

  // ---- Staff Leaves / Offs (monthly) ----
  async findLeavesForStaff(staffId: string) {
    return this.leaveRepo.find(
      { staff: { id: staffId } },
      { orderBy: { year: 'DESC', month: 'DESC' } },
    );
  }

  async upsertLeave(data: { staffId: string; month: number; year: number; offDays: number; note?: string }) {
    const staff = await this.staffRepo.findOne({ id: data.staffId });
    if (!staff) throw new NotFoundException('Staff member not found');

    let leave = await this.leaveRepo.findOne({
      staff,
      month: Number(data.month),
      year: Number(data.year),
    });

    if (leave) {
      leave.offDays = Number(data.offDays);
      if (data.note !== undefined) leave.note = data.note;
    } else {
      leave = this.leaveRepo.create({
        staff,
        month: Number(data.month),
        year: Number(data.year),
        offDays: Number(data.offDays),
        note: data.note,
      });
    }
    await this.leaveRepo.getEntityManager().persistAndFlush(leave);
    return leave;
  }
}
