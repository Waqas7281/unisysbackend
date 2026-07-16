// backend/src/fix-orphans.ts
//
// One-time cleanup: deletes rows left behind by students that were removed
// from the "students" table directly (no cascade existed on the student
// relation before this fix — see semester/fee/application/etc. entities).
// These orphan rows are what block `sync-schema` from re-adding the foreign
// key constraints. Run this once, then run `npm run sync-schema` again.
//
// Deletes in dependency order (children before parents):
//   application_actions -> applications -> letters -> academic_records -> fees -> semesters
import "reflect-metadata";
import { MikroORM } from "@mikro-orm/postgresql";
import mikroOrmConfig from "./mikro-orm.config";

async function tableExists(conn: any, table: string): Promise<boolean> {
  const rows = await conn.execute(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ?`,
    [table],
  );
  return rows.length > 0;
}

async function fixOrphans() {
  const orm = await MikroORM.init(mikroOrmConfig);
  const conn = orm.em.getConnection();

  const orphanCondition = `student_id NOT IN (SELECT id FROM students)`;

  // 1. application_actions — depends on applications, which depend on students
  if (await tableExists(conn, "application_actions")) {
    const deleted = await conn.execute(`
      DELETE FROM application_actions
      WHERE application_id IN (SELECT id FROM applications WHERE ${orphanCondition})
      RETURNING id;
    `);
    console.log(`Deleted ${deleted.length} orphan application_action row(s).`);
  }

  // 2. applications
  if (await tableExists(conn, "applications")) {
    const deleted = await conn.execute(`
      DELETE FROM applications WHERE ${orphanCondition} RETURNING id;
    `);
    console.log(`Deleted ${deleted.length} orphan application row(s).`);
  }

  // 3. letters
  if (await tableExists(conn, "letters")) {
    const deleted = await conn.execute(`
      DELETE FROM letters WHERE ${orphanCondition} RETURNING id;
    `);
    console.log(`Deleted ${deleted.length} orphan letter row(s).`);
  }

  // 4. academic_records
  if (await tableExists(conn, "academic_records")) {
    const deleted = await conn.execute(`
      DELETE FROM academic_records WHERE ${orphanCondition} RETURNING id;
    `);
    console.log(`Deleted ${deleted.length} orphan academic_record row(s).`);
  }

  // 5. fees — references both students and semesters
  if (await tableExists(conn, "fees")) {
    const deleted = await conn.execute(`
      DELETE FROM fees
      WHERE ${orphanCondition}
         OR semester_id IN (SELECT id FROM semesters WHERE ${orphanCondition})
      RETURNING id;
    `);
    console.log(`Deleted ${deleted.length} orphan fee row(s).`);
  }

  // 6. semesters — last, now that nothing else references the orphan rows
  if (await tableExists(conn, "semesters")) {
    const deleted = await conn.execute(`
      DELETE FROM semesters WHERE ${orphanCondition} RETURNING id;
    `);
    console.log(`Deleted ${deleted.length} orphan semester row(s).`);
  }

  console.log("✅ Orphan cleanup done. Now run: npm run sync-schema");
  await orm.close();
}

fixOrphans().catch((err) => {
  console.error("Orphan cleanup failed:", err);
  process.exit(1);
});
