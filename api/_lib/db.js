import postgres from 'postgres';

let sql = null;
let schemaReady = null;

export function databaseUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
}

export function getSql() {
  if (sql) return sql;
  const url = databaseUrl();
  if (!url) return null;
  sql = postgres(url, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    // Required for Neon's pooled (pgbouncer) endpoint
    prepare: false,
    // int8 columns hold ms timestamps and sequence numbers; both fit in a JS number
    types: {
      bigint: {
        to: 20,
        from: [20],
        serialize: (x) => x.toString(),
        parse: (x) => Number(x)
      }
    },
    onnotice: () => {}
  });
  return sql;
}

export function ensureSchema(db) {
  if (!schemaReady) {
    schemaReady = db.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(7461)`;
      await tx`create sequence if not exists palate_seq`;
      await tx`
        create table if not exists projects (
          id          text primary key,
          name        text not null,
          created_at  bigint not null,
          updated_at  bigint not null,
          deleted_at  bigint,
          seq         bigint not null
        )`;
      await tx`
        create table if not exists notes (
          id          text primary key,
          project_id  text,
          title       text not null default '',
          body        text not null default '',
          pinned      boolean not null default false,
          created_at  bigint not null,
          updated_at  bigint not null,
          deleted_at  bigint,
          seq         bigint not null,
          search      tsvector generated always as (
            to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))
          ) stored
        )`;
      await tx`
        create table if not exists note_versions (
          id           bigserial primary key,
          note_id      text not null,
          title        text not null default '',
          body         text not null default '',
          saved_at     bigint not null,
          captured_at  bigint not null,
          reason       text not null default 'edit'
        )`;
      await tx`create index if not exists projects_seq_idx on projects (seq)`;
      await tx`create index if not exists notes_seq_idx on notes (seq)`;
      await tx`create index if not exists notes_search_idx on notes using gin (search)`;
      await tx`create index if not exists note_versions_note_idx on note_versions (note_id, id desc)`;
    }).catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

export function projectFromRow(r) {
  return {
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
    seq: r.seq
  };
}

export function noteFromRow(r) {
  return {
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    body: r.body,
    pinned: r.pinned,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
    seq: r.seq
  };
}
