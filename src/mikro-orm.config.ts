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
  ClearanceSlip, // ← add karo
} from "./entities";

const config: MikroOrmModuleOptions = {
  driver: PostgreSqlDriver,
  clientUrl: process.env.DATABASE_URL,

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
    ClearanceSlip, // ← add karo
  ],

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
