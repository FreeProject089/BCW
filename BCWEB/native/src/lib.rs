#![deny(clippy::all)]
//! CPU-heavy helpers moved off the Node event loop. Each exported function returns an
//! AsyncTask, so the work runs on the libuv threadpool (a worker thread) and the JS side
//! gets a Promise — the main thread is never blocked, unlike the synchronous adm-zip /
//! large-payload crypto it replaces. See guides/RUST_WORKERS_PLAN.

use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi(object)]
pub struct ZipEntry {
    pub name: String,
    pub size: f64,
}

#[napi(object)]
pub struct ZipFile {
    pub name: String,
    pub data: Buffer,
}

fn read_zip(data: &[u8], with_bytes: bool) -> Result<Vec<(String, u64, Vec<u8>)>> {
    use std::io::Read;
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(data))
        .map_err(|e| Error::from_reason(format!("not_a_zip: {e}")))?;
    let mut out = Vec::with_capacity(archive.len());
    for i in 0..archive.len() {
        let mut f = archive
            .by_index(i)
            .map_err(|e| Error::from_reason(format!("bad_entry: {e}")))?;
        if f.is_dir() {
            continue;
        }
        let size = f.size();
        let bytes = if with_bytes {
            let mut b = Vec::with_capacity(size as usize);
            f.read_to_end(&mut b)
                .map_err(|e| Error::from_reason(format!("read_error: {e}")))?;
            b
        } else {
            Vec::new()
        };
        out.push((f.name().to_string(), size, bytes));
    }
    Ok(out)
}

pub struct ZipEntriesTask(Vec<u8>);
impl Task for ZipEntriesTask {
    type Output = Vec<(String, u64, Vec<u8>)>;
    type JsValue = Vec<ZipEntry>;
    fn compute(&mut self) -> Result<Self::Output> { read_zip(&self.0, false) }
    fn resolve(&mut self, _: Env, o: Self::Output) -> Result<Self::JsValue> {
        Ok(o.into_iter().map(|(name, size, _)| ZipEntry { name, size: size as f64 }).collect())
    }
}

/// List a zip's entries (name + uncompressed size) on a worker thread.
#[napi]
pub fn zip_entries(data: Buffer) -> AsyncTask<ZipEntriesTask> {
    AsyncTask::new(ZipEntriesTask(data.to_vec()))
}

pub struct ZipReadAllTask(Vec<u8>);
impl Task for ZipReadAllTask {
    type Output = Vec<(String, u64, Vec<u8>)>;
    type JsValue = Vec<ZipFile>;
    fn compute(&mut self) -> Result<Self::Output> { read_zip(&self.0, true) }
    fn resolve(&mut self, _: Env, o: Self::Output) -> Result<Self::JsValue> {
        Ok(o.into_iter().map(|(name, _, data)| ZipFile { name, data: data.into() }).collect())
    }
}

/// Read a zip's non-directory entries WITH their bytes, on a worker thread. Replaces the
/// adm-zip `new AdmZip(buf)` + per-entry `getData()` parse that blocked the event loop.
#[napi]
pub fn zip_read_all(data: Buffer) -> AsyncTask<ZipReadAllTask> {
    AsyncTask::new(ZipReadAllTask(data.to_vec()))
}

pub struct Blake3Task(Vec<u8>);
impl Task for Blake3Task {
    type Output = String;
    type JsValue = String;
    fn compute(&mut self) -> Result<Self::Output> { Ok(blake3::hash(&self.0).to_hex().to_string()) }
    fn resolve(&mut self, _: Env, o: Self::Output) -> Result<Self::JsValue> { Ok(o) }
}

/// BLAKE3 hash (hex) of a buffer on a worker thread — INTERNAL integrity only (dedup keys,
/// manifests, cache keys), never the public sha256 API contract.
#[napi]
pub fn blake3_hex(data: Buffer) -> AsyncTask<Blake3Task> {
    AsyncTask::new(Blake3Task(data.to_vec()))
}
