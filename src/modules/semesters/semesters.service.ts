import { Injectable } from "@nestjs/common";
import { EntityRepository } from "@mikro-orm/postgresql";
import { InjectRepository } from "@mikro-orm/nestjs";
import {
  Semester,
  SemesterSystem,
  SemesterType,
  Student,
} from "../../entities";

// Recognizes "Spring 2022", "Fall-2022", "FALL 2022", "spring2022", etc.
const SESSION_LABEL_PATTERN = /(fall|spring)\s*[-\s]?\s*(\d{4})/i;

// Recognizes a leading integer ("4", "4 Years", "BS (4 Years)") or, failing that,
// a spelled-out number word ("Two Years", "Four Year Program") up to ten.
const WORD_YEARS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

@Injectable()
export class SemestersService {
  constructor(
    @InjectRepository(Semester)
    private semesterRepo: EntityRepository<Semester>,
  ) {}

  /**
   * Program duration in years. Prefers the exact value derived from Fee Excel
   * imports (Student.programDurationYears — set via "Adm Session" + "Degree Years"
   * columns, see FeesService.importExcel), since real programs can be 2-year,
   * 3-year, etc. Falls back to the coarser semesterSystem enum (4-year/5-year),
   * and finally defaults to 5 years when neither has been set yet.
   */
  private programYears(student: Student): number {
    if (student.programDurationYears && student.programDurationYears > 0) {
      return student.programDurationYears;
    }
    return student.semesterSystem === SemesterSystem.FOUR_YEAR ? 4 : 5;
  }

  /**
   * Generates `years` consecutive year-pairs starting at startYear/startType, in
   * true chronological order — e.g. startType=Spring, startYear=2022, years=4:
   * Spring 2022, Fall 2022, Spring 2023, Fall 2023, Spring 2024, Fall 2024,
   * Spring 2025, Fall 2025 (8 semesters). The year only advances once per pair
   * (after the second semester of each pair), matching how a student's admission
   * session anchors their whole semester timeline.
   *
   * Defaults to starting at Fall (the original convention) so existing callers —
   * generateInitial/extendRollingWindow — keep their exact previous behavior.
   */
  private buildLabels(
    startYear: number,
    years: number,
    startOrder: number,
    startType: SemesterType = SemesterType.FALL,
  ) {
    const otherType =
      startType === SemesterType.FALL ? SemesterType.SPRING : SemesterType.FALL;
    const labels: {
      label: string;
      type: SemesterType;
      year: number;
      order: number;
    }[] = [];
    let order = startOrder;
    for (let i = 0; i < years; i++) {
      const year = startYear + i;
      labels.push({
        label: `${startType} ${year}`,
        type: startType,
        year,
        order: order++,
      });
      labels.push({
        label: `${otherType} ${year}`,
        type: otherType,
        year,
        order: order++,
      });
    }
    return labels;
  }

  /**
   * Initial generation: called once when admin sets the student's starting semester/year.
   * Number of semesters generated is driven by the student's program length
   * (Student.programDurationYears if set, else Student.semesterSystem), set by the
   * Accounts Manager or auto-derived from a Fee Excel import.
   *
   * `startType` lets the roadmap start on Spring instead of the Fall default — used
   * when the student's own "Adm Session" (e.g. "Spring 2025", captured at admission
   * time) tells us which term they actually started in, so the generated labels
   * match their real admission session instead of always assuming Fall.
   */
  async generateInitial(
    student: Student,
    startYear: number,
    startType: SemesterType = SemesterType.FALL,
  ) {
    const years = this.programYears(student);
    const labels = this.buildLabels(startYear, years, 1, startType);
    const semesters = labels.map((l) =>
      this.semesterRepo.create({ student, ...l }),
    );
    await this.semesterRepo.getEntityManager().persistAndFlush(semesters);
    return semesters;
  }

  /** Rolling generation: extends by another full program-length block once the existing block is exhausted. */
  async extendRollingWindow(student: Student) {
    const existing = await this.semesterRepo.find(
      { student },
      { orderBy: { order: "DESC" }, limit: 1 },
    );
    if (existing.length === 0) {
      // No semesters yet — nothing to extend from; caller should use generateInitial.
      return [];
    }
    const last = existing[0];
    const nextStartYear =
      last.type === SemesterType.SPRING ? last.year + 1 : last.year;
    const years = this.programYears(student);
    const labels = this.buildLabels(nextStartYear, years, last.order + 1);
    const semesters = labels.map((l) =>
      this.semesterRepo.create({ student, ...l }),
    );
    await this.semesterRepo.getEntityManager().persistAndFlush(semesters);
    return semesters;
  }

  findForStudent(studentId: string) {
    return this.semesterRepo.find(
      { student: studentId },
      { orderBy: { order: "ASC" } },
    );
  }

  async ensureUpToCurrent(student: Student) {
    // Auto-extends the rolling window if the student's semester list is running low (last 2 remaining).
    const all = await this.findForStudent(student.id);
    if (all.length === 0)
      return this.generateInitial(student, new Date().getFullYear());
    return all;
  }

  /**
   * Used by Fee Excel import: resolves a semester by its display label (e.g. "Fall 2026")
   * for a given student, creating it on the fly if it doesn't exist yet (e.g. the student's
   * window hasn't reached that far, or they were imported without semesters).
   */
  async findOrCreateByLabel(student: Student, label: string) {
    const clean = label.trim();
    const existing = await this.semesterRepo.findOne({ student, label: clean });
    if (existing) return existing;

    const parsed = this.parseSessionLabel(clean);
    const type = parsed ? parsed.type : SemesterType.FALL;
    const year = parsed ? parsed.year : new Date().getFullYear();

    const last = await this.semesterRepo.find(
      { student },
      { orderBy: { order: "DESC" }, limit: 1 },
    );
    const order = last.length ? last[0].order + 1 : 1;

    const semester = this.semesterRepo.create({
      student,
      label: clean,
      type,
      year,
      order,
    });
    await this.semesterRepo.getEntityManager().persistAndFlush(semester);
    return semester;
  }

  /**
   * Parses a session label like "Spring 2022", "Fall-2026", "spring2022" into its
   * type + year. Returns null if the label doesn't contain a recognizable
   * Fall/Spring + 4-digit-year pattern.
   */
  parseSessionLabel(label: any): { type: SemesterType; year: number } | null {
    if (label === null || label === undefined) return null;
    const str = String(label).trim();
    if (!str) return null;
    const match = str.match(SESSION_LABEL_PATTERN);
    if (!match) return null;
    const type =
      match[1].toLowerCase() === "spring"
        ? SemesterType.SPRING
        : SemesterType.FALL;
    const year = Number(match[2]);
    return { type, year };
  }

  /**
   * Parses a "Degree Years" cell — "4", "4.0", "4 Years", "BS (4 Years)", or a
   * spelled-out word like "Two Years" — into a whole number of years. Returns
   * null when nothing usable is found.
   */
  parseDegreeYears(raw: any): number | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === "number" && raw > 0) return Math.round(raw);
    const str = String(raw).trim();
    if (!str) return null;

    const numMatch = str.match(/(\d+(\.\d+)?)/);
    if (numMatch) {
      const n = parseFloat(numMatch[1]);
      if (n > 0) return Math.round(n);
    }

    const wordMatch = str
      .toLowerCase()
      .match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/);
    if (wordMatch) return WORD_YEARS[wordMatch[1]];

    return null;
  }

  /**
   * Generates a student's full semester roadmap anchored exactly at their admission
   * session, alternating Spring/Fall in true chronological order (see buildLabels),
   * for `years` × 2 semesters total (e.g. 4-year degree => 8 semesters). This is the
   * entry point used by Fee Excel import: it reads "Adm Session" (e.g. "Spring 2022")
   * and "Degree Years" (e.g. "4") from the sheet and reconstructs every semester the
   * student will ever have, up front, in one go.
   *
   * Idempotent: if the student already has semesters generated, this does nothing
   * and returns the existing list — it never duplicates or re-numbers an existing
   * roadmap on repeat imports.
   */
  async generateFromAdmission(
    student: Student,
    admType: SemesterType,
    admYear: number,
    years: number,
  ): Promise<{ semesters: Semester[]; generated: boolean }> {
    const existing = await this.findForStudent(student.id);
    if (existing.length > 0) return { semesters: existing, generated: false };

    const labels = this.buildLabels(admYear, years, 1, admType);
    const semesters = labels.map((l) =>
      this.semesterRepo.create({ student, ...l }),
    );
    await this.semesterRepo.getEntityManager().persistAndFlush(semesters);
    return { semesters, generated: true };
  }
}
