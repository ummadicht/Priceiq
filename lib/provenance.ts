import { query, queryOne } from "./db.ts";
import { SEED_SOURCE } from "./seed.ts";

export type Provenance = {
  realPrograms: Array<{ id: string; name: string; observations: number }>;
  seededPrograms: number;
  realObservations: number;
  seededObservations: number;
};

export async function provenance(): Promise<Provenance> {
  const real = await query<{ id: string; name: string; n: number }>(
    `SELECT p.id, p.name, count(*) n
       FROM observations o
       JOIN programs p ON p.id = o.program_id
      WHERE o.run_id NOT IN (SELECT id FROM runs WHERE note = $1)
      GROUP BY p.id, p.name ORDER BY n DESC`,
    [SEED_SOURCE]
  );

  const seededObsRow = await queryOne<{ c: number }>(
    `SELECT count(*) c FROM observations
      WHERE run_id IN (SELECT id FROM runs WHERE note = $1)`,
    [SEED_SOURCE]
  );
  const seededObs = Number(seededObsRow?.c || 0);

  const seededProgRow = await queryOne<{ c: number }>(
    "SELECT count(DISTINCT program_id) c FROM runs WHERE note = $1",
    [SEED_SOURCE]
  );
  const seededPrograms = Number(seededProgRow?.c || 0);

  return {
    realPrograms: real.map((r) => ({ id: String(r.id), name: String(r.name), observations: Number(r.n) })),
    seededPrograms,
    realObservations: real.reduce((t, r) => t + Number(r.n), 0),
    seededObservations: seededObs,
  };
}
