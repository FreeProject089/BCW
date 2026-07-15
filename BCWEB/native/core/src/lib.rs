#![deny(clippy::all)]
//! Pure-Rust core for the CPU-heavy helpers: zip read/write/extract, filesystem scan,
//! BLAKE3, zstd, and image resize. No napi/Node dependency, so it unit-tests under plain
//! `cargo test` and can be shared with the BMM Tauri app. The napi addon (../src/lib.rs)
//! is a thin async wrapper over these functions. Errors are plain `String`s.

use std::io::{Read, Write};

/// One zip entry: (name, uncompressed size, bytes). `bytes` is empty when `with_bytes` is false.
pub type ZipItem = (String, u64, Vec<u8>);

/// Read a zip's non-directory entries. With `with_bytes`, each entry's bytes are inflated.
pub fn read_zip(data: &[u8], with_bytes: bool) -> Result<Vec<ZipItem>, String> {
    let mut archive =
        zip::ZipArchive::new(std::io::Cursor::new(data)).map_err(|e| format!("not_a_zip: {e}"))?;
    let mut out = Vec::with_capacity(archive.len());
    for i in 0..archive.len() {
        let mut f = archive.by_index(i).map_err(|e| format!("bad_entry: {e}"))?;
        if f.is_dir() {
            continue;
        }
        let size = f.size();
        let bytes = if with_bytes {
            let mut b = Vec::with_capacity(size as usize);
            f.read_to_end(&mut b).map_err(|e| format!("read_error: {e}"))?;
            b
        } else {
            Vec::new()
        };
        out.push((f.name().to_string(), size, bytes));
    }
    Ok(out)
}

/// Extract ONE entry's bytes by name (None if missing or a directory).
pub fn read_one(data: &[u8], name: &str) -> Result<Option<Vec<u8>>, String> {
    let mut archive =
        zip::ZipArchive::new(std::io::Cursor::new(data)).map_err(|e| format!("not_a_zip: {e}"))?;
    let mut f = match archive.by_name(name) {
        Ok(f) => f,
        Err(zip::result::ZipError::FileNotFound) => return Ok(None),
        Err(e) => return Err(format!("bad_entry: {e}")),
    };
    if f.is_dir() {
        return Ok(None);
    }
    let mut b = Vec::with_capacity(f.size() as usize);
    f.read_to_end(&mut b).map_err(|e| format!("read_error: {e}"))?;
    Ok(Some(b))
}

/// Build a deflate zip from (name, bytes) pairs.
pub fn create_zip(files: Vec<(String, Vec<u8>)>) -> Result<Vec<u8>, String> {
    let mut cursor = std::io::Cursor::new(Vec::new());
    {
        let mut zw = zip::ZipWriter::new(&mut cursor);
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, data) in files {
            zw.start_file(name, opts).map_err(|e| format!("zip_write: {e}"))?;
            zw.write_all(&data).map_err(|e| format!("zip_write: {e}"))?;
        }
        zw.finish().map_err(|e| format!("zip_write: {e}"))?;
    }
    Ok(cursor.into_inner())
}

/// Recursively list a directory's files as (relative forward-slashed path, size).
pub fn scan_dir(root: &str) -> Vec<(String, u64)> {
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
                out.push((rel, size));
            }
        }
    }
    out
}

/// BLAKE3 hex hash of a buffer.
pub fn blake3_hex(data: &[u8]) -> String {
    blake3::hash(data).to_hex().to_string()
}

/// zstd compress / decompress.
pub fn zstd_compress(data: &[u8], level: i32) -> Result<Vec<u8>, String> {
    zstd::encode_all(data, level).map_err(|e| format!("zstd: {e}"))
}
pub fn zstd_decompress(data: &[u8]) -> Result<Vec<u8>, String> {
    zstd::decode_all(data).map_err(|e| format!("zstd: {e}"))
}

/// Downscale a raster to `width` (never upscale → None) and encode JPEG at `quality`.
pub fn resize_jpeg(data: &[u8], width: u32, quality: u8) -> Result<Option<Vec<u8>>, String> {
    let img = image::load_from_memory(data).map_err(|e| format!("decode: {e}"))?;
    let (w, h) = (img.width(), img.height());
    if w == 0 || width >= w {
        return Ok(None);
    }
    let target_h = (((h as f64) * (width as f64 / w as f64)).round() as u32).max(1);
    let resized = img.resize_exact(width, target_h, image::imageops::FilterType::Lanczos3);
    let rgb = resized.to_rgb8();
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality)
        .encode_image(&rgb)
        .map_err(|e| format!("encode: {e}"))?;
    Ok(Some(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zip_roundtrip_and_extract() {
        let z = create_zip(vec![
            ("a.txt".into(), b"hi".to_vec()),
            ("d/b.bin".into(), vec![1, 2, 3]),
            ("empty".into(), vec![]),
        ])
        .unwrap();
        let mut files = read_zip(&z, true).unwrap();
        files.sort_by(|a, b| a.0.cmp(&b.0));
        assert_eq!(
            files.iter().map(|(n, _, _)| n.as_str()).collect::<Vec<_>>(),
            vec!["a.txt", "d/b.bin", "empty"]
        );
        assert_eq!(files[0].2, b"hi"); // a.txt bytes
        assert_eq!(read_one(&z, "d/b.bin").unwrap(), Some(vec![1, 2, 3]));
        assert_eq!(read_one(&z, "nope").unwrap(), None);
    }

    #[test]
    fn not_a_zip_errors() {
        assert!(read_zip(b"not a zip", true).is_err());
    }

    #[test]
    fn blake3_is_deterministic() {
        let a = blake3_hex(b"BetterCommunity");
        assert_eq!(a.len(), 64);
        assert_eq!(a, blake3_hex(b"BetterCommunity"));
        assert_ne!(a, blake3_hex(b"other"));
    }

    #[test]
    fn zstd_roundtrips() {
        let orig = vec![7u8; 4096];
        let c = zstd_compress(&orig, 3).unwrap();
        assert!(c.len() < orig.len());
        assert_eq!(zstd_decompress(&c).unwrap(), orig);
    }

    #[test]
    fn resize_only_downscales() {
        let img = image::RgbImage::from_pixel(8, 4, image::Rgb([200, 100, 50]));
        let mut png = Vec::new();
        img.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        let small = resize_jpeg(&png, 4, 80).unwrap();
        assert!(small.is_some() && !small.unwrap().is_empty()); // 8 -> 4
        assert_eq!(resize_jpeg(&png, 16, 80).unwrap(), None); // no upscale
    }

    #[test]
    fn scan_dir_lists_files() {
        let dir = std::env::temp_dir().join(format!("bcweb-core-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("x.txt"), b"hello").unwrap(); // 5
        std::fs::write(dir.join("sub").join("y.bin"), [1, 2, 3]).unwrap(); // 3
        let mut got = scan_dir(dir.to_str().unwrap());
        got.sort();
        assert_eq!(got, vec![("sub/y.bin".into(), 3), ("x.txt".into(), 5)]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
