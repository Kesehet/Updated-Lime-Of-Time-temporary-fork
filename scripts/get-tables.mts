import { db } from '../server/db.js';
import { sql } from 'drizzle-orm';

const result = await db.execute(sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`);
console.log((result as any[]).map((x: any) => x.table_name).join('\n'));
process.exit(0);
