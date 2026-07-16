import { Migration } from '@mikro-orm/migrations';

export class Migration20260709203345 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "custom_field_definitions" ("id" varchar(255) not null, "name" varchar(255) not null, "applies_to" text check ("applies_to" in ('Fee', 'Student')) not null, "data_type" varchar(255) not null default 'text', "column_order" int null, "created_by_user_id" varchar(255) null, "created_at" timestamptz not null, constraint "custom_field_definitions_pkey" primary key ("id"));`);

    this.addSql(`create table "students" ("id" varchar(255) not null, "enrollment_number" varchar(255) not null, "name" varchar(255) not null, "section" varchar(255) null, "program" varchar(255) null, "semester_system" text check ("semester_system" in ('4-year', '5-year')) null, "email" varchar(255) null, "custom_fields" jsonb null, "created_by" varchar(255) null, "created_at" timestamptz not null, "updated_at" timestamptz null, constraint "students_pkey" primary key ("id"));`);
    this.addSql(`alter table "students" add constraint "students_enrollment_number_unique" unique ("enrollment_number");`);

    this.addSql(`create table "semesters" ("id" varchar(255) not null, "student_id" varchar(255) not null, "label" varchar(255) not null, "type" text check ("type" in ('Fall', 'Spring')) not null, "year" int not null, "order" int not null, "created_at" timestamptz not null, constraint "semesters_pkey" primary key ("id"));`);
    this.addSql(`create index "semesters_student_id_index" on "semesters" ("student_id");`);

    this.addSql(`create table "fees" ("id" varchar(255) not null, "student_id" varchar(255) not null, "semester_id" varchar(255) not null, "fee_type" varchar(255) not null, "amount" numeric(12,2) not null default 0, "installment_number" int not null default 1, "due_date" timestamptz null, "last_fee_date" timestamptz null, "paid_status" varchar(255) not null default 'unpaid', "paid_amount" numeric(12,2) not null default 0, "custom_values" jsonb null, "drop" boolean not null default false, "dpt" boolean not null default false, "bar" boolean not null default false, "cancel" boolean not null default false, "drop_of_scholarship" boolean not null default false, "created_at" timestamptz not null, "updated_at" timestamptz null, constraint "fees_pkey" primary key ("id"));`);
    this.addSql(`create index "fees_student_id_index" on "fees" ("student_id");`);

    this.addSql(`create table "users" ("id" varchar(255) not null, "name" varchar(255) not null, "email" varchar(255) not null, "password_hash" varchar(255) not null, "role" text check ("role" in ('Manager', 'AccountsManager', 'StudentAffair', 'DataEntry', 'RecordRoom', 'Registrar')) not null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz null, constraint "users_pkey" primary key ("id"));`);
    this.addSql(`alter table "users" add constraint "users_email_unique" unique ("email");`);

    this.addSql(`create table "notifications" ("id" varchar(255) not null, "recipient_id" varchar(255) not null, "type" varchar(255) not null, "reference_type" varchar(255) null, "reference_id" varchar(255) null, "message" varchar(255) not null, "is_read" boolean not null default false, "created_at" timestamptz not null, constraint "notifications_pkey" primary key ("id"));`);
    this.addSql(`create index "notifications_recipient_id_index" on "notifications" ("recipient_id");`);

    this.addSql(`create table "applications" ("id" varchar(255) not null, "student_id" varchar(255) not null, "title" varchar(255) not null, "description" text null, "created_by_id" varchar(255) not null, "status" text check ("status" in ('Pending', 'Assigned', 'UnderReview', 'Accepted', 'Rejected')) not null default 'Pending', "assigned_to_id" varchar(255) null, "assigned_role" varchar(255) null, "locked" boolean not null default false, "decision_reason" varchar(255) null, "decided_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz null, constraint "applications_pkey" primary key ("id"));`);
    this.addSql(`create index "applications_student_id_index" on "applications" ("student_id");`);

    this.addSql(`create table "application_actions" ("id" varchar(255) not null, "application_id" varchar(255) not null, "performed_by_id" varchar(255) not null, "performed_by_role" varchar(255) not null, "action_type" varchar(255) not null, "title" varchar(255) null, "description" text null, "amount" numeric(12,2) null, "date" timestamptz null, "original_action_id" varchar(255) null, "is_deleted" boolean not null default false, "created_at" timestamptz not null, constraint "application_actions_pkey" primary key ("id"));`);
    this.addSql(`create index "application_actions_application_id_index" on "application_actions" ("application_id");`);

    this.addSql(`create table "academic_records" ("id" varchar(255) not null, "student_id" varchar(255) not null, "level" text check ("level" in ('Matric', 'Intermediate', 'Degree')) not null, "session_start_year" int null, "session_end_year" int null, "total_marks" int null, "obtained_marks" int null, "entered_by_id" varchar(255) null, "created_at" timestamptz not null, constraint "academic_records_pkey" primary key ("id"));`);
    this.addSql(`create index "academic_records_student_id_index" on "academic_records" ("student_id");`);

    this.addSql(`alter table "semesters" add constraint "semesters_student_id_foreign" foreign key ("student_id") references "students" ("id") on update cascade;`);

    this.addSql(`alter table "fees" add constraint "fees_student_id_foreign" foreign key ("student_id") references "students" ("id") on update cascade;`);
    this.addSql(`alter table "fees" add constraint "fees_semester_id_foreign" foreign key ("semester_id") references "semesters" ("id") on update cascade;`);

    this.addSql(`alter table "notifications" add constraint "notifications_recipient_id_foreign" foreign key ("recipient_id") references "users" ("id") on update cascade;`);

    this.addSql(`alter table "applications" add constraint "applications_student_id_foreign" foreign key ("student_id") references "students" ("id") on update cascade;`);
    this.addSql(`alter table "applications" add constraint "applications_created_by_id_foreign" foreign key ("created_by_id") references "users" ("id") on update cascade;`);
    this.addSql(`alter table "applications" add constraint "applications_assigned_to_id_foreign" foreign key ("assigned_to_id") references "users" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "application_actions" add constraint "application_actions_application_id_foreign" foreign key ("application_id") references "applications" ("id") on update cascade;`);
    this.addSql(`alter table "application_actions" add constraint "application_actions_performed_by_id_foreign" foreign key ("performed_by_id") references "users" ("id") on update cascade;`);

    this.addSql(`alter table "academic_records" add constraint "academic_records_student_id_foreign" foreign key ("student_id") references "students" ("id") on update cascade;`);
    this.addSql(`alter table "academic_records" add constraint "academic_records_entered_by_id_foreign" foreign key ("entered_by_id") references "users" ("id") on update cascade on delete set null;`);
  }

}
