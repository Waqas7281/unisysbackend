import { MikroOrmModuleOptions } from "@mikro-orm/nestjs";
import { PostgreSqlDriver } from "@mikro-orm/postgresql";
import { Migrator } from "@mikro-orm/migrations";
import "dotenv/config";

const isProd = process.env.NODE_ENV === "production";

const config: MikroOrmModuleOptions = {
  driver: PostgreSqlDriver,
  clientUrl: process.env.DATABASE_URL,

  // MikroORM needs `entities` populated at runtime.
  // To avoid Node/TS module-loader issues, always point to compiled JS.
  // (Start with `nest build` then `nest start --watch`.)
  entities: ["./dist/**/*.entity.js"],

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
