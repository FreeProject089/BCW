// The `bmm` project, shared by every suite that needs "a real project" and never deleted.
//
// Four suites need the project keyed `bmm` (catalog items, the BMM launch feed, project
// followers). They run in parallel in one database, and each used to fend for itself:
//
//   · two did `project.upsert({ where: { key: 'bmm' } })`. On a FRESH database (CI, a throwaway
//     one) two concurrent upserts both miss, both insert, and the loser dies on the unique key
//     (P2002). Prisma's upsert is not atomic across connections.
//   · two did "create it if absent, and delete it afterwards if I created it". Whichever
//     suite created it deleted it while the others were still inserting catalog items under
//     it, and those inserts failed on CatalogItem_projectId_fkey, in suites that had nothing
//     wrong with them.
//
// So: one function, race-safe (a lost insert race reads the winner's row), and the row is
// never deleted by a test. It is the platform's own flagship project; in a dev database it
// exists already, and in a throwaway one leaving it costs nothing.
export async function sharedBmmProject(p) {
  const found = await p.project.findUnique({ where: { key: 'bmm' } });
  if (found) return found;
  try {
    return await p.project.create({ data: { key: 'bmm', name: 'Better Mods Manager' } });
  } catch (e) {
    if (e?.code !== 'P2002') throw e;
    return p.project.findUnique({ where: { key: 'bmm' } });
  }
}
