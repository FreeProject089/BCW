// Object storage (S3 / MinIO). Two clients:
//  - internal: server-side ops (ensure bucket) over the docker network.
//  - signer:   builds pre-signed URLs against the PUBLIC endpoint, because the
//              browser PUTs/GETs directly to that host (the signature is bound to it).
import { S3Client, CreateBucketCommand, HeadBucketCommand, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
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
