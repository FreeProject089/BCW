// Object storage (S3 / MinIO). Two clients:
//  - internal: server-side ops (ensure bucket) over the docker network.
//  - signer:   builds pre-signed URLs against the PUBLIC endpoint, because the
//              browser PUTs/GETs directly to that host (the signature is bound to it).
import { S3Client, CreateBucketCommand, HeadBucketCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const REGION = 'us-east-1';
const BUCKET = process.env.S3_BUCKET || 'bcweb';
const INTERNAL = process.env.S3_ENDPOINT || 'http://minio:9000';
const PUBLIC = process.env.S3_PUBLIC_ENDPOINT || 'http://localhost:9000';
const creds = { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY };

const common = { region: REGION, credentials: creds, forcePathStyle: true };
const internal = new S3Client({ ...common, endpoint: INTERNAL });
const signer = new S3Client({ ...common, endpoint: PUBLIC });

export const STORAGE = { BUCKET };

export async function ensureBucket() {
  try { await internal.send(new HeadBucketCommand({ Bucket: BUCKET })); }
  catch { await internal.send(new CreateBucketCommand({ Bucket: BUCKET })); }
}

/** Cheap reachability probe for the server-perf dashboard's "service down" check. */
export async function checkStorageHealth() {
  try { await internal.send(new HeadBucketCommand({ Bucket: BUCKET })); return true; } catch { return false; }
}

/** Pre-signed PUT so the client uploads the bytes directly (never through the API). */
export async function presignPut(key, contentType, expiresIn = 600) {
  return getSignedUrl(signer, new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }), { expiresIn });
}

/** Pre-signed GET for downloads of a published payload. */
export async function presignGet(key, expiresIn = 600) {
  return getSignedUrl(signer, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn });
}

/** Stream an object (used to serve blog media with stable public URLs). */
export async function getObject(key) {
  const res = await internal.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return { body: res.Body, contentType: res.ContentType || 'application/octet-stream', length: res.ContentLength };
}

/** Delete an object (used by the scheduled-deletion sweeper). Never throws. */
export async function deleteObject(key) {
  if (!key) return;
  try { await internal.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })); } catch { /* best effort */ }
}

/** Sum object sizes (and count) under a key prefix — for the storage dashboard. */
export async function prefixUsage(prefix) {
  let bytes = 0, count = 0, token;
  do {
    const res = await internal.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }));
    for (const o of res.Contents || []) { bytes += Number(o.Size || 0); count += 1; }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return { bytes, count };
}
