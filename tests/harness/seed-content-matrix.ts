/** LOCAL REHEARSAL ONLY: seed the synthetic content matrix (published/expired/draft… of every kind) into the local test DB. */
import { Session, seedUsers } from "../db";
import { seedContentMatrix } from "../fixtures/content-matrix";
(async () => { await seedUsers(); const r = await seedContentMatrix(); await Session.closeAll(); console.log(`seeded ${r.rows.length} synthetic rows`); process.exit(0); })();
