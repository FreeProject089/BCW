#![deny(clippy::all)]
//! Thin napi async wrapper over the pure `bcweb-core` functions. Each exported function
//! returns an AsyncTask, so the work runs on the libuv threadpool (a worker thread) and the
//! JS side gets a Promise — the main thread is never blocked, unlike the synchronous adm-zip
//! / large-payload crypto it replaces. The actual logic (unit-tested, shareable with the BMM
//! Tauri app) lives in ../core. See guides/RUST_WORKERS_PLAN.

use napi::bindgen_prelude::*;
use napi_derive::napi;

fn err(e: String) -> Error {
    Error::from_reason(e)
}

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

#[napi(object)]
pub struct ScanEntry {
    pub path: String,
    pub size: f64,
}

pub struct ZipEntriesTask(Vec<u8>);
impl Task for ZipEntriesTask {
    type Output = Vec<bcweb_core::ZipItem>;
    type JsValue = Vec<ZipEntry>;
    fn compute(&mut self) -> Result<Self::Output> {
        bcweb_core::read_zip(&self.0, false).map_err(err)
    }
    fn resolve(&mut self, _: Env, o: Self::Output) -> Result<Self::JsValue> {
        Ok(o.into_iter()
            .map(|(name, size, _)| ZipEntry {
                name,
                size: size as f64,
            })
            .collect())
    }
}

/// List a zip's entries (name + uncompressed size) on a worker thread.
#[napi]
pub fn zip_entries(data: Buffer) -> AsyncTask<ZipEntriesTask> {
    AsyncTask::new(ZipEntriesTask(data.to_vec()))
}

pub struct ZipReadAllTask(Vec<u8>);
impl Task for ZipReadAllTask {
    type Output = Vec<bcweb_core::ZipItem>;
    type JsValue = Vec<ZipFile>;
    fn compute(&mut self) -> Result<Self::Output> {
        bcweb_core::read_zip(&self.0, true).map_err(err)
    }
    fn resolve(&mut self, _: Env, o: Self::Output) -> Result<Self::JsValue> {
        Ok(o.into_iter()
            .map(|(name, _, data)| ZipFile {
                name,
                data: data.into(),
            })
            .collect())
    }
}

/// Read a zip's non-directory entries WITH their bytes, on a worker thread. Replaces the
/// adm-zip `new AdmZip(buf)` + per-entry `getData()` parse that blocked the event loop.
#[napi]
pub fn zip_read_all(data: Buffer) -> AsyncTask<ZipReadAllTask> {
    AsyncTask::new(ZipReadAllTask(data.to_vec()))
}

pub struct ZipEntryTask {
    data: Vec<u8>,
    name: String,
}
impl Task for ZipEntryTask {
    type Output = Option<Vec<u8>>;
    type JsValue = Option<Buffer>;
    fn compute(&mut self) -> Result<Self::Output> {
        bcweb_core::read_one(&self.data, &self.name).map_err(err)
    }
    fn resolve(&mut self, _: Env, o: Self::Output) -> Result<Self::JsValue> {
        Ok(o.map(|b| b.into()))
    }
}

/// Extract ONE zip entry's bytes by name, on a worker thread (null if missing / a dir).
#[napi]
pub fn zip_entry(data: Buffer, name: String) -> AsyncTask<ZipEntryTask> {
    AsyncTask::new(ZipEntryTask {
        data: data.to_vec(),
        name,
    })
}

pub struct ZipCreateTask(Vec<(String, Vec<u8>)>);
impl Task for ZipCreateTask {
    type Output = Vec<u8>;
    type JsValue = Buffer;
    fn compute(&mut self) -> Result<Self::Output> {
        bcweb_core::create_zip(std::mem::take(&mut self.0)).map_err(err)
    }
    fn resolve(&mut self, _: Env, o: Self::Output) -> Result<Self::JsValue> {
        Ok(o.into())
    }
}

/// Build a zip (deflate) from `[{name, data}]` on a worker thread.
#[napi]
pub fn zip_create(files: Vec<ZipFile>) -> AsyncTask<ZipCreateTask> {
    AsyncTask::new(ZipCreateTask(
        files
            .into_iter()
            .map(|f| (f.name, f.data.to_vec()))
            .collect(),
    ))
}

pub struct DirScanTask(String);
impl Task for DirScanTask {
    type Output = Vec<(String, u64)>;
    type JsValue = Vec<ScanEntry>;
    fn compute(&mut self) -> Result<Self::Output> {
        Ok(bcweb_core::scan_dir(&self.0))
    }
    fn resolve(&mut self, _: Env, o: Self::Output) -> Result<Self::JsValue> {
        Ok(o.into_iter()
            .map(|(path, size)| ScanEntry {
                path,
                size: size as f64,
            })
            .collect())
    }
}

/// Recursively list a directory's files as `[{path, size}]` on a worker thread.
#[napi]
pub fn dir_scan(root: String) -> AsyncTask<DirScanTask> {
    AsyncTask::new(DirScanTask(root))
}

pub struct ZstdCompressTask(Vec<u8>, i32);
impl Task for ZstdCompressTask {
    type Output = Vec<u8>;
    type JsValue = Buffer;
    fn compute(&mut self) -> Result<Self::Output> {
        bcweb_core::zstd_compress(&self.0, self.1).map_err(err)
    }
    fn resolve(&mut self, _: Env, o: Self::Output) -> Result<Self::JsValue> {
        Ok(o.into())
    }
}

/// zstd-compress a buffer on a worker thread (INTERNAL artifacts only).
#[napi]
pub fn zstd_compress(data: Buffer, level: i32) -> AsyncTask<ZstdCompressTask> {
    AsyncTask::new(ZstdCompressTask(data.to_vec(), level))
}

pub struct ZstdDecompressTask(Vec<u8>);
impl Task for ZstdDecompressTask {
    type Output = Vec<u8>;
    type JsValue = Buffer;
    fn compute(&mut self) -> Result<Self::Output> {
        bcweb_core::zstd_decompress(&self.0).map_err(err)
    }
    fn resolve(&mut self, _: Env, o: Self::Output) -> Result<Self::JsValue> {
        Ok(o.into())
    }
}

/// zstd-decompress a buffer on a worker thread.
#[napi]
pub fn zstd_decompress(data: Buffer) -> AsyncTask<ZstdDecompressTask> {
    AsyncTask::new(ZstdDecompressTask(data.to_vec()))
}

pub struct ImageResizeTask {
    data: Vec<u8>,
    width: u32,
    quality: u8,
}
impl Task for ImageResizeTask {
    type Output = Option<Vec<u8>>;
    type JsValue = Option<Buffer>;
    fn compute(&mut self) -> Result<Self::Output> {
        bcweb_core::resize_jpeg(&self.data, self.width, self.quality).map_err(err)
    }
    fn resolve(&mut self, _: Env, o: Self::Output) -> Result<Self::JsValue> {
        Ok(o.map(|b| b.into()))
    }
}

/// Downscale a raster image to `width` (never upscale → null) and encode JPEG, on a worker thread.
#[napi]
pub fn image_resize_jpeg(data: Buffer, width: u32, quality: u8) -> AsyncTask<ImageResizeTask> {
    AsyncTask::new(ImageResizeTask {
        data: data.to_vec(),
        width,
        quality,
    })
}

pub struct Blake3Task(Vec<u8>);
impl Task for Blake3Task {
    type Output = String;
    type JsValue = String;
    fn compute(&mut self) -> Result<Self::Output> {
        Ok(bcweb_core::blake3_hex(&self.0))
    }
    fn resolve(&mut self, _: Env, o: Self::Output) -> Result<Self::JsValue> {
        Ok(o)
    }
}

/// BLAKE3 hash (hex) of a buffer on a worker thread — INTERNAL integrity only (dedup keys,
/// manifests, cache keys), never the public sha256 API contract.
#[napi]
pub fn blake3_hex(data: Buffer) -> AsyncTask<Blake3Task> {
    AsyncTask::new(Blake3Task(data.to_vec()))
}
