# ADR — Object storage after MinIO

**Status:** decided, 2026-09-24. **Decision:** the bundled object store is the
[Versity S3 Gateway](https://github.com/versity/versitygw) (`versity/versitygw:v1.8.0`, Apache-2.0)
with its POSIX backend. French version: [ADR_S3_STORAGE_FR.md](ADR_S3_STORAGE_FR.md).

## Why a decision was needed

The stack ran `minio/minio:RELEASE.2025-09-07T16-13-09Z`. MinIO stopped publishing community
images in October 2025, removed `minio/minio` from Docker Hub on 2026-09-11, and quay.io refuses
anonymous pulls. A host that had the image cached kept working; a **fresh host could not deploy
BCWEB at all**. Tag bumps could not fix that, so the server had to change.

## What BCWEB actually asks of S3

Read from the code, not assumed (`apps/api/src/lib/storage.mjs` is the only S3 client in the API;
`apps/provisioner/src/index.mjs` has a second, smaller one):

| Used | Where |
| --- | --- |
| `HeadBucket`, `CreateBucket` | `ensureBucket()` at API boot, the provisioner, the status probe |
| `PutObject` (server side) | feedback attachments, contact-thread files, marketplace files, provisioner `.keep` |
| `GetObject` (streamed) | blog media proxy, hosted-repo file serving, avatars, backups, media hashing |
| `DeleteObject` | sweeper, closures, moderation, catalog removal |
| `ListObjectsV2` with prefix + continuation token | storage dashboard (`prefixUsage`), media-hash backfill |
| Presigned **PUT** and **GET** (SigV4 query string) | every browser upload and download goes straight to storage |
| **CORS** on the storage origin | the browser PUTs/GETs cross-origin (site on `:5176` or the domain, storage on `:9000` or `s3.` domain) |
| Path-style addressing (`forcePathStyle: true`) | one hostname in Caddy, no wildcard DNS |
| No SDK default checksums (`WHEN_REQUIRED`) | presigned URLs must not carry `x-amz-checksum-*` |

**Not used anywhere:** multipart upload, `CopyObject`, `DeleteObjects`, bucket policies or
anonymous read, versioning, lifecycle rules, object lock, the MinIO admin API or console, the `mc`
client. The one bucket is private; every public byte goes through a presigned URL or the API.

## Candidates

| | versitygw v1.8.0 | Garage v2.4.1 | SeaweedFS 4.47 | RustFS 1.0.0 |
| --- | --- | --- | --- | --- |
| Licence | Apache-2.0 | **AGPL-3.0** | Apache-2.0 | Apache-2.0 |
| Image (Docker Hub, anonymous) | `versity/versitygw`, ~31 MB | `dxflrs/garage`, ~27 MB | `chrislusf/seaweedfs`, ~92 MB | `rustfs/rustfs`, ~110 MB |
| Release cadence (2026) | about monthly, v1.1 → v1.8 | v2.2 Jan, v2.3 Apr, v2.4 Sep | weekly | 1.0.0 GA on 2026-09-16, RCs before |
| Everything BCWEB uses | yes, **measured** (below) | yes per its compatibility table | yes per its docs, not measured | yes per its docs, not measured |
| Credentials | any string, from env | key ids must be `GK` + 24 hex, secret 64 hex; imported through its CLI | JSON identities file | env, MinIO-style |
| Bootstrap | none (the API creates the bucket) | node layout assign + apply, key import, bucket allow, RPC secret, admin token | master + volume + filer + S3 in one process, config files | none |
| Global CORS | `--cors-allow-origin` (like MinIO's) | per bucket only | not checked | not checked |
| On-disk data | **plain files**, one per object | own block store + metadata DB | own volume files | own format |
| Backup of the volume | a plain `tar` is complete and readable | needs its metadata snapshot, a live tar is unsafe | its own tooling | its own tooling |

AGPL is not a blocker for Garage: BCWEB would run it unmodified, and the AGPL network clause only
bites on a *modified* version offered over the network. It lost on the operational column, not the
licence: key ids in a fixed format (so every existing `S3_ACCESS_KEY` changes), a cluster layout to
initialise even for one node, CORS to configure per bucket, and a data directory a `tar` cannot
safely copy while it runs. SeaweedFS is the heaviest to operate for a single bucket. RustFS is the
closest drop-in for MinIO but was eight days out of release candidate on the day of the decision;
it is the natural second choice if versitygw ever stalls.

## Why versitygw

- **Nothing to bootstrap.** Root access key and secret come from the environment, any string, so
  the existing `S3_ACCESS_KEY` / `S3_SECRET_KEY` keep working and nothing is written into the data.
  The API's `ensureBucket()` creates the bucket exactly as it did with MinIO. No `mc`, no init job.
- **Same wire contract.** Port 9000, path-style, region `us-east-1` (passed from `S3_REGION`),
  one global CORS origin. `S3_ENDPOINT` changes from `http://minio:9000` to `http://storage:9000`;
  the browser-facing `S3_PUBLIC_ENDPOINT` and the Caddy `S3_DOMAIN` block do not change.
- **Data you can read.** Every object is the file `/data/buckets/<bucket>/<key>`; its Content-Type
  and ETag are small files under `/data/meta` (the *sidecar*, chosen over xattrs because the
  busybox `tar` in `infra/backup/backup.sh` drops xattrs). A backup is a normal tarball that
  restores without the server running.
- **Small and non-root.** ~31 MB Alpine image with `wget` for the healthcheck and a `--health`
  endpoint; it runs as uid 1000 in compose (the image itself defaults to root).

## Measured before deciding (2026-09-24)

A script drove the real `storage.mjs` against versitygw v1.8.0 and, as a control, against the
cached MinIO release, each in a throwaway container: bucket create/head, browser-style presigned
PUT with a CORS preflight, presigned GET, server-side put and streamed get (bytes, type, length),
an empty object, 1,005 keys listed across two pages, prefix usage, delete, delete of a missing key,
the provisioner's client, wrong credentials refused, tampered signature refused, anonymous GET
refused. **20 of 20 on both servers.** Then `rclone copy` MinIO → versitygw of a sample bucket
(12 MiB, 0-byte and nested objects, seven content types): `rclone check`, `rclone check
--download` and a Content-Type comparison, all identical.

Two differences, both honest ones:

1. **A key cannot be both a file and a folder.** `a` and `a/b` cannot coexist on a POSIX backend:
   versitygw answers the second PUT `409` (`ObjectParentIsFile` / `ExistingObjectIsDirectory`).
   MinIO stored both and then listed only one. The only place a user chooses a full key is a
   hosted repo's file path, so `presignRepoFile` now refuses the clash itself with
   `409 path_conflict` (`apps/api/test/repo-file-path-conflict.test.mjs`).
2. **No admin console.** MinIO's `:9001` console is gone; versitygw's optional WebUI is not
   enabled. Storage is administered through the S3 API (rclone, the AWS CLI) or the files.

Found on the way, **true of MinIO too**: the presigned PUT signs the `host` header only, so the
store enforces neither the Content-Type nor the size the API checked when it issued the URL. The
comments that claimed otherwise (`Caddyfile`, `uploads.mjs`) now say so.

## Consequences

- Compose service `minio` → `storage`, volume `minio-data` → `s3-data`, env
  `MINIO_API_CORS_ALLOW_ORIGIN` → `S3_CORS_ALLOW_ORIGIN`, new optional `S3_HOST_PORT`.
- Existing installs move their data once with rclone: [DEPLOY_EN.md → Moving off MinIO](../run/DEPLOY_EN.md#moving-off-minio).
  The old volume is not declared any more and is never deleted by compose.
- Backups archive `s3-data` as `s3-<ts>.tar.gz` ([BACKUP_EN.md](../run/BACKUP_EN.md)).
- Leaving the bundled store for Cloudflare R2 stays env-only, as before.
