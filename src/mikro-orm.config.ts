import { MikroOrmModuleOptions } from "@mikro-orm/nestjs";
import { PostgreSqlDriver } from "@mikro-orm/postgresql";
import { Migrator } from "@mikro-orm/migrations";
import "dotenv/config";
import {
  User,
  Student,
  Semester,
  Fee,
  CustomFieldDefinition,
  Application,
  ApplicationAction,
  AcademicRecord,
  Notification,
  Letter,
  Staff,
  StaffApplication,
  StaffLeave,
} from "./entities";

const config: MikroOrmModuleOptions = {
  driver: PostgreSqlDriver,
  clientUrl: process.env.DATABASE_URL,

  // Explicit entity classes instead of a glob path into ./dist. This
  // works identically whether the app is run normally (nest build ->
  // dist -> PM2) or bundled for a serverless platform like Vercel,
  // which doesn't produce a dist folder in the same shape.
  entities: [
    User,
    Student,
    Semester,
    Fee,
    CustomFieldDefinition,
    Application,
    ApplicationAction,
    AcademicRecord,
    Notification,
    Letter,
    Staff,
    StaffApplication,
    StaffLeave,
  ],

  // Keep entity discovery deterministic.
  autoLoadEntities: false,

  driverOptions: {
    connection: {
      ssl: { rejectUnauthorized: false },
    },
  },
  migrations: {
    path: "./src/migrations",
    transactional: true,
  },
  seeder: {
    path: "./src/seeders",
    defaultSeeder: "DatabaseSeeder",
  },
};

export default config;
