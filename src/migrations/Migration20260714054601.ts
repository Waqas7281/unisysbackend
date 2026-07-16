import { Migration } from '@mikro-orm/migrations';

export class Migration20260714054601 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "students" add column "program_duration_years" int null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "students" drop column "program_duration_years";`);
  }

}
