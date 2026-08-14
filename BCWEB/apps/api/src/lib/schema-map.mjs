// The database, read from the two files that define it.
//
// schema.prisma says what the models are. packages/db/migrations says what was actually done
// to the database. They are supposed to agree, and nothing checks that they do — which is
// how an index came to exist in Postgres, be created by a migration, and be absent from the
// schema: the next `migrate diff` proposed DROPPING it, because a diff believes the schema.
// That was found by accident while generating an unrelated migration.
//
// So this does two things. It maps the schema — models, relations, indexes — which answers
// "what talks to what" without reading two thousand lines. And it diffs the indexes the
// migrations create against the indexes the schema declares, which is the drift that
// silently destroys one.
//
// Pure text in, structure out. No database is touched: the answer is a property of the
// files, and a tool that needed a live connection could not run in CI.

/** Split `model X { … }` blocks. Brace-counting rather than a lazy regex, because a Json
 *  default like `@default("{}")` contains a brace and ends the block early otherwise. */
export function splitModels(schema) {
  const out = [];
  const re = /\bmodel\s+([A-Za-z0-9_]+)\s*\{/g;
  let m;
  while ((m = re.exec(schema))) {
    let depth = 1;
    let i = re.lastIndex;
    for (; i < schema.length && depth > 0; i++) {
      if (schema[i] === '{') depth++;
      else if (schema[i] === '}') depth--;
    }
    out.push({ name: m[1], body: schema.slice(re.lastIndex, i - 1) });
  }
  return out;
}

const SCALARS = new Set(['String', 'Int', 'BigInt', 'Float', 'Boolean', 'DateTime', 'Json', 'Decimal', 'Bytes']);

/**
 * One model: its scalar fields, the models it points at, and the indexes it declares.
 *
 * A relation is recorded from the side that HOLDS the foreign key, because that is the side
 * a query filters on and the side a delete is blocked by. Recording both directions would
 * double every edge and make the map denser than the thing it describes.
 */
export function parseModel({ name, body }) {
  const fields = [];
  const relations = [];
  const indexes = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('///')) continue;

    if (line.startsWith('@@index') || line.startsWith('@@unique')) {
      const inner = line.match(/\[([^\]]*)\]/);
      if (inner) {
        indexes.push({
          unique: line.startsWith('@@unique'),
          fields: inner[1].split(',').map((x) => x.trim()).filter(Boolean),
        });
      }
      continue;
    }
    const m = line.match(/^([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)(\[\])?(\?)?/);
    if (!m) continue;
    const [, field, type, list, optional] = m;
    if (SCALARS.has(type)) {
      fields.push({ name: field, type, list: !!list, optional: !!optional, id: /@id\b/.test(line) });
      // A field-level @unique is an index too, and leaving it out makes the map disagree
      // with the database about what is enforced.
      if (/@unique\b/.test(line)) indexes.push({ unique: true, fields: [field] });
    } else if (/@relation/.test(line) || !list) {
      // An enum-typed field carries a real @unique too. Recorded before the relation
      // branch consumes the line, because `key ProjectKey @unique` looks like neither a
      // scalar nor a relation and was falling through both.
      if (/@unique\b/.test(line)) indexes.push({ unique: true, fields: [field] });
      // Only the FK-holding side names its columns in @relation(fields: [...]).
      const holds = line.match(/fields:\s*\[([^\]]*)\]/);
      relations.push({ field, to: type, list: !!list, optional: !!optional, holdsKey: !!holds });
    }
  }
  return { name, fields, relations, indexes };
}

export function mapSchema(schema) {
  const models = splitModels(schema).map(parseModel);
  return {
    models,
    // Edges from the side that holds the key. That is the side a cascade travels along, and
    // the direction somebody tracing a delete actually needs.
    edges: models.flatMap((m) => m.relations.filter((r) => r.holdsKey).map((r) => ({ from: m.name, to: r.to, via: r.field }))),
  };
}

/** Index names a migration creates, and drops. Postgres names them, so the name is what the
 *  two sides can be compared on. */
export function indexesInMigrations(files) {
  const created = new Map();
  const dropped = new Set();
  for (const { name, sql } of files) {
    for (const m of String(sql).matchAll(/CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF NOT EXISTS\s+)?"([^"]+)"/gi)) {
      if (!created.has(m[2])) created.set(m[2], name);
    }
    for (const m of String(sql).matchAll(/DROP\s+INDEX\s+(?:IF EXISTS\s+)?"([^"]+)"/gi)) dropped.add(m[1]);
  }
  return { created, dropped };
}

/**
 * Indexes a migration created and the schema does not declare.
 *
 * The exact drift that nearly cost an index: raw SQL created it, the schema never mentioned
 * it, and the next generated migration proposed dropping it — silently, in a diff somebody
 * would have committed without reading closely.
 *
 * Prisma's naming is `Model_field_idx` / `Model_field_key`, so the name can be rebuilt from
 * the schema and compared. Anything not matching that convention is reported as `unknown`
 * rather than as drift: a hand-named index is a deliberate act, and calling it a fault
 * would train people to ignore this.
 */
export function findIndexDrift(schema, migrationFiles) {
  const { models } = mapSchema(schema);
  const declared = new Set();
  for (const m of models) {
    for (const idx of m.indexes) {
      const full = `${m.name}_${idx.fields.join('_')}_${idx.unique ? 'key' : 'idx'}`;
      declared.add(full);
      // Identifiers are capped at 63 characters, and the SUFFIX is kept: Prisma clips the
      // middle, not the end. `…_allShowcase_key` (69) becomes `…_allSh_key` (63), not
      // `…_allShowca` — so a naive slice(0, 63) still fails to match and still reports an
      // ordinary @@unique as drift. Measured against the real migration rather than
      // assumed.
      if (full.length > 63) {
        const suffix = idx.unique ? '_key' : '_idx';
        declared.add(full.slice(0, 63 - suffix.length) + suffix);
      }
    }
    // Prisma also creates one for every @id, under a _pkey name.
    const id = m.fields.find((f) => f.id);
    if (id) declared.add(`${m.name}_pkey`);
  }

  const { created, dropped } = indexesInMigrations(migrationFiles);
  const orphaned = [];
  const unknown = [];
  for (const [idxName, file] of created) {
    if (dropped.has(idxName)) continue;          // created then removed later — fine
    if (declared.has(idxName)) continue;
    // Foreign-key indexes Prisma creates implicitly are named _fkey and are not declared.
    if (/_fkey$/.test(idxName)) continue;
    if (/^[A-Za-z0-9_]+_[A-Za-z0-9_]+_(idx|key)$/.test(idxName)) orphaned.push({ index: idxName, migration: file });
    else unknown.push({ index: idxName, migration: file });
  }
  return { declared: declared.size, createdInSql: created.size, orphaned, unknown };
}
