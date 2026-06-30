// Provisioner — watches for hosted Server-Repos in PROVISIONING and brings them
// ONLINE. It owns the isolation/quota concern, decoupled from the web API.
//
// This scaffold provisions a storage area (a MinIO prefix) per repo and publishes
// a URL. The clearly-marked extension point `spinUpRepoContainer()` is where a real
// deploy would create an isolated container + quota'd volume (e.g. via dockerode),
// enforcing storageQuotaBytes / uploadLimitKbps / cpuShare from the plan.

import { PrismaClient } from '@prisma/client';
import { S3Client, PutObjectCommand, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';

const prisma = new PrismaClient();
const BUCKET = process.env.S3_BUCKET || 'bcweb';
const REPO_BASE = process.env.REPO_PUBLIC_BASE || 'http://localhost/repos';
const s3 = new S3Client({
  region: 'us-east-1', forcePathStyle: true,
  endpoint: process.env.S3_ENDPOINT || 'http://minio:9000',
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY },
});

async function ensureBucket() {
  try { await s3.send(new HeadBucketCommand({ Bucket: BUCKET })); }
  catch { await s3.send(new CreateBucketCommand({ Bucket: BUCKET })); }
}

// EXTENSION POINT: real container + quota'd volume goes here.
async function spinUpRepoContainer(repo) {
  // e.g. dockerode: create a volume sized to repo.storageQuotaBytes, run the
  // repo-server image with CPU share repo.cpuShare and an upload throttle of
  // repo.uploadLimitKbps, mounted at repos/<id>/. For now we just stake out the
  // storage prefix so the repo has a home.
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: `repos/${repo.id}/.keep`, Body: '' }));
  return { publicUrl: `${REPO_BASE}/${repo.id}` };
}

async function tick() {
  const repos = await prisma.serverRepo.findMany({ where: { status: 'PROVISIONING' }, take: 5 });
  for (const repo of repos) {
    try {
      const { publicUrl } = await spinUpRepoContainer(repo);
      await prisma.serverRepo.update({ where: { id: repo.id }, data: { status: 'ONLINE', publicUrl } });
      await prisma.notification.create({ data: { userId: repo.ownerId, kind: 'hosting_online', body: `Your hosted repo "${repo.name}" is now online.` } }).catch(() => {});
      console.log(`[provisioner] ${repo.id} -> ONLINE (${publicUrl})`);
    } catch (e) {
      console.error(`[provisioner] failed ${repo.id}:`, e?.message || e);
    }
  }
}

await ensureBucket().catch(() => {});
console.log('[provisioner] watching for PROVISIONING repos…');
setInterval(() => tick().catch((e) => console.error(e)), Number(process.env.POLL_MS || 5000));
