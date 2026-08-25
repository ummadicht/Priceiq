import { db } from "./db.ts";
import { SEED_SOURCE } from "./seed.ts";

/**
 * WHICH NUMBERS ARE REAL.
 *
 * The moment one genuine source lands, "everything here is a worked example"
 * stops being true — and a blanket disclaimer over a mix is worse than none,
 * because it teaches people to ignore the banner and then they ignore it on the
 * screens that are still invented.
 *
 * So the banner reports the actual split, by name.
 */
export type Provenance = {
  realPrograms: Array<{ id: string; name: string; observations: number }>;
  seededPrograms: number;
  realObservations: number;
  seededObservations: number;
};

export function provenance(): Provenance {
  const d = db();
  // A run carrying the seed marker is worked-example data; anything else came
  // from a real import or a hand entry.
  const real = d.prepare(
    `SELECT p.id, p.name, count(*) n
       FROM observations o
       JOIN programs p ON p.id = o.program_id
      WHERE o.run_id NOT IN (SELECT id FROM runs WHERE note = ?)
      GROUP BY p.id ORDER BY n DESC`
  ).all(SEED_SOURCE) as Array<{ id: string; name: string; n: number }>;

  const seededObs = (d.prepare(
    `SELECT count(*) c FROM observations
      WHERE run_id IN (SELECT id FROM runs WHERE note = ?)`
  ).get(SEED_SOURCE) as { c: number }).c;

  return {
    realPrograms: real.map((r) => ({ id: r.id, name: r.name, observations: r.n })),
    seededPrograms: (d.prepare("SELECT count(DISTINCT program_id) c FROM runs WHERE note = ?")
      .get(SEED_SOURCE) as { c: number }).c,
    realObservations: real.reduce((t, r) => t + r.n, 0),
    seededObservations: seededObs,
  };
}
