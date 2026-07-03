// Provisioner — watches for hosted Server-Repos in PROVISIONING and brings them
// ONLINE. It owns the isolation/quota concern, decoupled from the web API.
//
// This scaffold provisions a storage area (a MinIO prefix) per repo and publishes
// a URL. The clearly-marked extension point `spinUpRepoContainer()` is where a real
// deploy would create an isolated container + quota'd volume (e.g. via dockerode),
// enforcing storageQuotaBytes / uploadLimitKbps / cpuShare from the plan.

import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { S3Client, PutObjectCommand, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

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
  // Runtime sandbox enforcement (bans, whitelist, bandwidth cap) already happens at
  // serve time in the API (routes/hosting-content.mjs). A future deploy can additionally
  // isolate at the OS level here — e.g. dockerode: a volume sized to storageQuotaBytes,
  // the repo-server image with CPU share cpuShare and an upload throttle of
  // uploadLimitKbps. For now we stake out the storage prefix so the repo has a home.
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

// Periodically ping non-hosted, listed repos to keep their ONLINE/OFFLINE status
// (and basic validity) fresh, without anyone clicking.
async function checkRepos() {
  const repos = await prisma.serverRepo.findMany({ where: { hosted: false, repoUrl: { not: null } }, take: 50 });
  for (const r of repos) {
    let status = 'OFFLINE', valid = false, sha = null;
    try {
      const res = await fetch(r.repoUrl, { signal: AbortSignal.timeout(8000), redirect: 'follow' });
      if (res.ok) {
        const t = await res.text();
        try { JSON.parse(t); valid = true; sha = sha256(t); status = 'ONLINE'; } catch { status = 'ONLINE'; valid = false; }
      }
    } catch { /* offline */ }
    // Auto-reconcile status, content hash, and verification (valid manifest → verified).
    const data = {};
    if (status !== r.status) data.status = status;
    if (sha && sha !== r.sha) data.sha = sha;
    if (r.listed && r.verified !== valid) { data.verified = valid; data.pendingReview = false; }
    if (Object.keys(data).length) await prisma.serverRepo.update({ where: { id: r.id }, data }).catch(() => {});
  }
}
checkRepos().catch(() => {});
setInterval(() => checkRepos().catch((e) => console.error('[repo-check]', e?.message || e)), Number(process.env.REPO_CHECK_MS || 60000));
console.log('[provisioner] repo health checks every', Number(process.env.REPO_CHECK_MS || 60000) / 1000, 's');
