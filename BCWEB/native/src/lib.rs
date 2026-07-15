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
    fn compute(&mut self) -> Result<Self::Output> {
        read_zip(&self.0, false)
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
    type Output = Vec<(String, u64, Vec<u8>)>;
    type JsValue = Vec<ZipFile>;
    fn compute(&mut self) -> Result<Self::Output> {
        read_zip(&self.0, true)
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

fn read_one(data: &[u8], name: &str) -> Result<Option<Vec<u8>>> {
    use std::io::Read;
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(data))
        .map_err(|e| Error::from_reason(format!("not_a_zip: {e}")))?;
    let mut f = match archive.by_name(name) {
        Ok(f) => f,
        Err(zip::result::ZipError::FileNotFound) => return Ok(None),
        Err(e) => return Err(Error::from_reason(format!("bad_entry: {e}"))),
    };
    if f.is_dir() {
        return Ok(None);
    }
    let mut b = Vec::with_capacity(f.size() as usize);
    f.read_to_end(&mut b)
        .map_err(|e| Error::from_reason(format!("read_error: {e}")))?;
    Ok(Some(b))
}

pub struct ZipEntryTask {
    data: Vec<u8>,
    name: String,
}
impl Task for ZipEntryTask {
    type Output = Option<Vec<u8>>;
    type JsValue = Option<Buffer>;
    fn compute(&mut self) -> Result<Self::Output> {
        read_one(&self.data, &self.name)
    }
    fn resolve(&mut self, _: Env, o: Self::Output) -> Result<Self::JsValue> {
        Ok(o.map(|b| b.into()))
    }
}

/// Extract ONE zip entry's bytes by name, on a worker thread (null if missing / a dir).
/// Replaces `new AdmZip(buf).getEntry(name).getData()` for single-file extraction.
#[napi]
pub fn zip_entry(data: Buffer, name: String) -> AsyncTask<ZipEntryTask> {
    AsyncTask::new(ZipEntryTask {
        data: data.to_vec(),
        name,
    })
}

// ── ZIP create (write) ───────────────────────────────────────────────────────
fn create_zip(files: Vec<(String, Vec<u8>)>) -> Result<Vec<u8>> {
    use std::io::Write;
    let mut cursor = std::io::Cursor::new(Vec::new());
    {
        let mut zw = zip::ZipWriter::new(&mut cursor);
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, data) in files {
            zw.start_file(name, opts)
                .map_err(|e| Error::from_reason(format!("zip_write: {e}")))?;
            zw.write_all(&data)
                .map_err(|e| Error::from_reason(format!("zip_write: {e}")))?;
        }
        zw.finish()
            .map_err(|e| Error::from_reason(format!("zip_write: {e}")))?;
    }
    Ok(cursor.into_inner())
}

pub struct ZipCreateTask(Vec<(String, Vec<u8>)>);
impl Task for ZipCreateTask {
    type Output = Vec<u8>;
    type JsValue = Buffer;
    fn compute(&mut self) -> Result<Self::Output> {
        create_zip(std::mem::take(&mut self.0))
    }
    fn resolve(&mut self, _: Env, o: Self::Output) -> Result<Self::JsValue> {
        Ok(o.into())
    }
}

/// Build a zip (deflate) from `[{name, data}]` on a worker thread. Replaces adm-zip's
/// synchronous `new AdmZip()` + `addFile()` + `toBuffer()` for exports.
#[napi]
pub fn zip_create(files: Vec<ZipFile>) -> AsyncTask<ZipCreateTask> {
    AsyncTask::new(ZipCreateTask(
        files
            .into_iter()
            .map(|f| (f.name, f.data.to_vec()))
            .collect(),
    ))
}

// ── Filesystem scan ──────────────────────────────────────────────────────────
#[napi(object)]
pub struct ScanEntry {
    pub path: String,
    pub size: f64,
}

fn scan_dir(root: &str) -> Vec<ScanEntry> {
    let base = std::path::Path::new(root);
    let mut out = Vec::new();
    let mut stack = vec![base.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let rd = match std::fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for e in rd.flatten() {
            let ft = match e.file_type() {
                Ok(t) => t,
                Err(_) => continue,
            };
            let p = e.path();
            if ft.is_dir() {
                stack.push(p);
            } else if ft.is_file() {
                let size = e.metadata().map(|m| m.len()).unwrap_or(0);
                let rel = p
                    .strip_prefix(base)
                    .unwrap_or(&p)
                    .to_string_lossy()
                    .replace('\\', "/");
                out.push(ScanEntry {
                    path: rel,
                    size: size as f64,
                });
            }
        }
    }
    out
}

pub struct DirScanTask(String);
impl Task for DirScanTask {
    type Output = Vec<ScanEntry>;
    type JsValue = Vec<ScanEntry>;
    fn compute(&mut self) -> Result<Self::Output> {
        Ok(scan_dir(&self.0))
    }
    fn resolve(&mut self, _: Env, o: Self::Output) -> Result<Self::JsValue> {
        Ok(o)
    }
}

/// Recursively list a directory's files as `[{path, size}]` (relative, forward-slashed) on
/// a worker thread. For size accounting / backup manifests without blocking the loop.
#[napi]
pub fn dir_scan(root: String) -> AsyncTask<DirScanTask> {
    AsyncTask::new(DirScanTask(root))
}

// ── zstd (internal artifacts) ────────────────────────────────────────────────
pub struct ZstdCompressTask(Vec<u8>, i32);
impl Task for ZstdCompressTask {
    type Output = Vec<u8>;
    type JsValue = Buffer;
    fn compute(&mut self) -> Result<Self::Output> {
        zstd::encode_all(&self.0[..], self.1).map_err(|e| Error::from_reason(format!("zstd: {e}")))
    }
    fn resolve(&mut self, _: Env, o: Self::Output) -> Result<Self::JsValue> {
        Ok(o.into())
    }
}

/// zstd-compress a buffer on a worker thread (INTERNAL artifacts only — the public download
/// format is unchanged). `level` ~ 3 is a good default.
#[napi]
pub fn zstd_compress(data: Buffer, level: i32) -> AsyncTask<ZstdCompressTask> {
    AsyncTask::new(ZstdCompressTask(data.to_vec(), level))
}

pub struct ZstdDecompressTask(Vec<u8>);
impl Task for ZstdDecompressTask {
    type Output = Vec<u8>;
    type JsValue = Buffer;
    fn compute(&mut self) -> Result<Self::Output> {
        zstd::decode_all(&self.0[..]).map_err(|e| Error::from_reason(format!("zstd: {e}")))
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

// ── Image resize ─────────────────────────────────────────────────────────────
fn resize_jpeg(data: &[u8], width: u32, quality: u8) -> Result<Option<Vec<u8>>> {
    let img =
        image::load_from_memory(data).map_err(|e| Error::from_reason(format!("decode: {e}")))?;
    let (w, h) = (img.width(), img.height());
    if w == 0 || width >= w {
        return Ok(None); // never upscale — caller serves the original
    }
    let target_h = (((h as f64) * (width as f64 / w as f64)).round() as u32).max(1);
    let resized = img.resize_exact(width, target_h, image::imageops::FilterType::Lanczos3);
    let rgb = resized.to_rgb8();
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality)
        .encode_image(&rgb)
        .map_err(|e| Error::from_reason(format!("encode: {e}")))?;
    Ok(Some(out))
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
        resize_jpeg(&self.data, self.width, self.quality)
    }
    fn resolve(&mut self, _: Env, o: Self::Output) -> Result<Self::JsValue> {
        Ok(o.map(|b| b.into()))
    }
}

/// Downscale a raster image to `width` (never upscale → null) and encode JPEG, on a worker
/// thread. Replaces the @napi-rs/canvas resize that ran on the main thread.
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
        Ok(blake3::hash(&self.0).to_hex().to_string())
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
