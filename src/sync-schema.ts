import 'reflect-metadata';
import { MikroORM } from '@mikro-orm/postgresql';
import mikroOrmConfig from './mikro-orm.config';

async function sync() {
  const orm = await MikroORM.init(mikroOrmConfig);
  const generator = orm.getSchemaGenerator();
  await generator.updateSchema();
  console.log('✅ Database schema synced successfully.');
  await orm.close();
}

sync().catch((err) => {
  console.error('Schema sync failed:', err);
  process.exit(1);
});
