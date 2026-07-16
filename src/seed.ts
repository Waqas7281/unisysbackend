import 'reflect-metadata';
import { MikroORM } from '@mikro-orm/postgresql';
import * as bcrypt from 'bcrypt';
import mikroOrmConfig from './mikro-orm.config';
import { User, UserRole } from './entities';

async function seed() {
  const orm = await MikroORM.init(mikroOrmConfig);
  const em = orm.em.fork();

  const existing = await em.findOne(User, { email: 'admin@university.edu.pk' });
  if (existing) {
    console.log('Manager account already exists: admin@university.edu.pk');
    await orm.close();
    return;
  }

  const passwordHash = await bcrypt.hash('Admin@12345', 10);
  const manager = em.create(User, {
    name: 'System Administrator',
    email: 'admin@university.edu.pk',
    passwordHash,
    role: UserRole.MANAGER,
  });
  await em.persistAndFlush(manager);

  console.log('✅ Manager account created:');
  console.log('   Email: admin@university.edu.pk');
  console.log('   Password: Admin@12345');
  console.log('   ⚠ Please log in and change this password / create real accounts immediately.');

  await orm.close();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
