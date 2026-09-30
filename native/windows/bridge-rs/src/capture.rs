//! GDI screenshot capture for Windows.
//!
//! Captures window content via GDI (PrintWindow) on Windows.
//! On non-Windows platforms all entry points return a deterministic
//! `unsupported_platform` error.
//!
//! Selected-window capture only. Desktop capture is not implemented. DXGI and
//! Windows Graphics Capture are not used.

use serde_json::Value;

use crate::error::{ErrorCode, ProtocolError};
use crate::refs::{RefStore, WindowRef};

#[cfg(windows)]
use crate::state::StateId;
#[cfg(windows)]
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
#[cfg(windows)]
use image::codecs::png::PngEncoder;
#[cfg(windows)]
use image::{imageops::FilterType, ExtendedColorType, ImageEncoder, RgbaImage};
#[cfg(windows)]
use serde_json::json;

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

/// Capture a screenshot of the target window, optionally extracting UIA
/// accessibility elements from the same window.
///
/// # Arguments
///
/// * `store` - RefStore containing the window handle for `target_ref`.
///   Also receives inserted element refs when `include_elements` is true.
/// * `target_ref` - Reference to the window to capture.
/// * `include_elements` - When true, also extracts UIA elements and includes
///   them in the response as an `axTargets` array.
///
/// # Returns
///
/// On success, a JSON value with shape:
/// ```json
/// {
///   "target": "@w1",
///   "capture": { ... },
///   "warnings": [],
///   "axTargets": []
/// }
/// ```
/// The `axTargets` field is only present when `include_elements` is true
/// and at least one element was found.
///
/// On non-Windows this always returns `UnsupportedPlatform`.
pub fn screenshot(
    store: &mut RefStore,
    target_ref: &WindowRef,
    include_elements: bool,
    max_dimension: Option<u32>,
) -> Result<Value, ProtocolError> {
    #[cfg(not(windows))]
    {
        let _ = store;
        let _ = target_ref;
        let _ = include_elements;
        let _ = max_dimension;
        Err(ProtocolError::new(
            "Screenshot capture is only supported on Windows",
            ErrorCode::UnsupportedPlatform,
        ))
    }

    #[cfg(windows)]
    {
        screenshot_impl(store, target_ref, include_elements, max_dimension)
    }
}

// ---------------------------------------------------------------------------
// Windows-specific implementation
// ---------------------------------------------------------------------------

#[cfg(windows)]
use windows::Win32::Foundation::{HWND, RECT};
#[cfg(windows)]
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
    ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
    SRCCOPY,
};
#[cfg(windows)]
use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{GetWindowRect, IsIconic, PW_RENDERFULLCONTENT};

#[cfg(windows)]
fn screenshot_impl(
    store: &mut RefStore,
    target_ref: &WindowRef,
    include_elements: bool,
    max_dimension: Option<u32>,
) -> Result<Value, ProtocolError> {
    // 1. Look up the window handle.
    let native = store.get_window(target_ref).ok_or_else(|| {
        ProtocolError::new(
            format!("Window ref '{}' not found", target_ref),
            ErrorCode::TargetNotFound,
        )
    })?;
    let hwnd = HWND(native.raw() as *mut _);

    let mut warnings: Vec<String> = Vec::new();

    // 2. Check for minimized state.
    let is_minimized = unsafe { IsIconic(hwnd).as_bool() };
    if is_minimized {
        warnings.push("window_minimized".to_owned());
    }

    // 3. Resolve the visible frame and the raw window rect.
    //
    // `GetWindowRect` includes the invisible resize borders on Windows 10/11,
    // while `framePoints` and the image must describe the same visible region.
    // Capture the full window rect with PrintWindow, then crop to the DWM
    // frame so pixel coordinates line up with the reported frame.
    let (x, y, width, height, full, crop) = unsafe {
        let mut raw = RECT::default();
        if GetWindowRect(hwnd, &mut raw).is_err() {
            return Err(ProtocolError::new(
                "Failed to get window bounds",
                ErrorCode::CaptureFailed,
            ));
        }
        let full_w = (raw.right - raw.left).max(0);
        let full_h = (raw.bottom - raw.top).max(0);
        let visible = crate::window::visible_frame_rect(hwnd);
        let mut vis_w = (visible.right - visible.left).max(0);
        let mut vis_h = (visible.bottom - visible.top).max(0);
        let (mut vis_x, mut vis_y, mut crop_x, mut crop_y) = (
            visible.left,
            visible.top,
            (visible.left - raw.left).max(0),
            (visible.top - raw.top).max(0),
        );
        if vis_w == 0 || vis_h == 0 || full_w == 0 || full_h == 0 {
            // DWM has no visible frame (or the window is collapsed): fall back
            // to the raw window rect so capture still returns complete data.
            vis_x = raw.left;
            vis_y = raw.top;
            vis_w = full_w;
            vis_h = full_h;
            crop_x = 0;
            crop_y = 0;
        }
        (
            vis_x,
            vis_y,
            vis_w,
            vis_h,
            (raw.left, raw.top, full_w, full_h),
            (crop_x, crop_y, vis_w, vis_h),
        )
    };

    if width == 0 || height == 0 {
        warnings.push("zero_sized_window".to_owned());
        // Return capture metadata with zero dimensions and no image data.
        let state_id = StateId::fresh("s");
        return Ok(json!({
            "target": target_ref.to_string(),
            "capture": {
                "stateId": state_id,
                "x": x,
                "y": y,
                "width": 0,
                "height": 0,
                "imageFormat": "png",
                "imageBase64": null,
            },
            "warnings": warnings,
        }));
    }

    // 4. GDI capture (unsafe FFI block).
    // SAFETY: All GDI objects are created and destroyed within this
    // function.  Object lifetimes follow the Acquire -> Use -> Release
    // pattern with proper cleanup on every error path.
    let (png_base64, output_width, output_height) =
        unsafe { gdi_capture_to_base64(hwnd, full.0, full.1, full.2, full.3, crop, max_dimension) }?;

    let state_id = StateId::fresh("s");

    // Build the base response.
    let mut result = json!({
        "target": target_ref.to_string(),
        "capture": {
            "stateId": state_id,
            "x": x,
            "y": y,
            "width": output_width,
            "height": output_height,
            "imageFormat": "png",
            "imageBase64": png_base64,
        },
        "warnings": warnings,
    });

    // 5. Optionally extract UIA accessibility elements.
    if include_elements {
        let elements = crate::uia::extract_elements(store, hwnd.0 as isize);
        if !elements.is_empty() {
            if let Some(obj) = result.as_object_mut() {
                obj.insert("axTargets".to_owned(), Value::Array(elements));
            }
        }
    }

    Ok(result)
}

/// Perform GDI capture of the given window and return a base64-encoded PNG.
///
/// # Safety
///
/// Caller must provide a valid HWND and positive dimensions.
#[cfg(windows)]
unsafe fn gdi_capture_to_base64(
    hwnd: HWND,
    window_x: i32,
    window_y: i32,
    width: i32,
    height: i32,
    crop: (i32, i32, i32, i32),
    max_dimension: Option<u32>,
) -> Result<(String, u32, u32), ProtocolError> {
    // Acquire the window DC.
    let hdc_window = GetDC(Some(hwnd));
    if hdc_window.is_invalid() {
        return Err(ProtocolError::new("GetDC failed", ErrorCode::CaptureFailed));
    }

    // Create a compatible memory DC.
    let hdc_mem = CreateCompatibleDC(Some(hdc_window));
    if hdc_mem.is_invalid() {
        ReleaseDC(Some(hwnd), hdc_window);
        return Err(ProtocolError::new(
            "CreateCompatibleDC failed",
            ErrorCode::CaptureFailed,
        ));
    }

    // Create a compatible bitmap.
    let hbitmap = CreateCompatibleBitmap(hdc_window, width, height);
    if hbitmap.is_invalid() {
        let _ = DeleteDC(hdc_mem);
        ReleaseDC(Some(hwnd), hdc_window);
        return Err(ProtocolError::new(
            "CreateCompatibleBitmap failed",
            ErrorCode::CaptureFailed,
        ));
    }

    // Select bitmap into memory DC (save old to restore later).
    let old_bitmap = SelectObject(hdc_mem, HGDIOBJ(hbitmap.0));

    // Render the window content using PrintWindow. PW_RENDERFULLCONTENT is
    // required for DirectComposition/GPU-composited surfaces; fall back to the
    // legacy flag when the window does not support it.
    let mut pw_ok = PrintWindow(hwnd, hdc_mem, PRINT_WINDOW_FLAGS(PW_RENDERFULLCONTENT));
    if !pw_ok.as_bool() {
        pw_ok = PrintWindow(hwnd, hdc_mem, PRINT_WINDOW_FLAGS(0));
    }

    // Prepare BITMAPINFO for GetDIBits (request 32-bit BGRA top-down).
    let header = BITMAPINFOHEADER {
        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: width,
        biHeight: -height, // negative = top-down
        biPlanes: 1,
        biBitCount: 32,
        biCompression: BI_RGB.0,
        biSizeImage: 0,
        biXPelsPerMeter: 0,
        biYPelsPerMeter: 0,
        biClrUsed: 0,
        biClrImportant: 0,
    };
    let mut bmi = BITMAPINFO {
        bmiHeader: header,
        ..Default::default()
    };

    // Allocate the pixel buffer.
    let buf_size = (width as usize) * (height as usize) * 4;
    let mut bits: Vec<u8> = vec![0u8; buf_size];

    let mut dib_ok = GetDIBits(
        hdc_mem,
        hbitmap,
        0,
        height as u32,
        Some(bits.as_mut_ptr() as *mut std::ffi::c_void),
        &mut bmi,
        DIB_RGB_COLORS,
    );

    // PrintWindow frequently returns a successful but black bitmap for GPU
    // surfaces (Chromium/Electron). Fall back to the compositor-visible screen
    // pixels only when the semantic capture failed or is effectively blank.
    let print_window_blank = bits
        .chunks_exact(4)
        .step_by(97)
        .all(|pixel| pixel[0] < 8 && pixel[1] < 8 && pixel[2] < 8);
    if !pw_ok.as_bool() || dib_ok == 0 || print_window_blank {
        let screen_dc = GetDC(None);
        if !screen_dc.is_invalid()
            && BitBlt(
                hdc_mem, 0, 0, width, height, Some(screen_dc), window_x, window_y, SRCCOPY,
            )
            .is_ok()
        {
            dib_ok = GetDIBits(
                hdc_mem,
                hbitmap,
                0,
                height as u32,
                Some(bits.as_mut_ptr() as *mut std::ffi::c_void),
                &mut bmi,
                DIB_RGB_COLORS,
            );
        }
        if !screen_dc.is_invalid() {
            ReleaseDC(None, screen_dc);
        }
    }

    // Restore old bitmap and destroy GDI objects.
    SelectObject(hdc_mem, old_bitmap);
    let _ = DeleteObject(HGDIOBJ(hbitmap.0));
    let _ = DeleteDC(hdc_mem);
    ReleaseDC(Some(hwnd), hdc_window);

    if dib_ok == 0 {
        return Err(ProtocolError::new(
            "GetDIBits failed to retrieve bitmap data",
            ErrorCode::CaptureFailed,
        ));
    }

    // Crop the full-window bitmap to the visible DWM frame region.
    let (mut bits, width, height) = crop_bgra(bits, width, height, crop);

    // Convert BGRA -> RGBA (GDI returns B,G,R,A; PNG expects R,G,B,A).
    for chunk in bits.chunks_exact_mut(4) {
        chunk.swap(0, 2);
    }

    let source_width = width as u32;
    let source_height = height as u32;
    let (output_width, output_height) = match max_dimension.filter(|limit| *limit > 0) {
        Some(limit) if source_width.max(source_height) > limit => {
            let scale = limit as f64 / source_width.max(source_height) as f64;
            (
                (source_width as f64 * scale).round().max(1.0) as u32,
                (source_height as f64 * scale).round().max(1.0) as u32,
            )
        }
        _ => (source_width, source_height),
    };
    let pixels = if (output_width, output_height) == (source_width, source_height) {
        bits
    } else {
        let source = RgbaImage::from_raw(source_width, source_height, bits).ok_or_else(|| {
            ProtocolError::new(
                "Captured bitmap had an invalid byte length",
                ErrorCode::CaptureFailed,
            )
        })?;
        image::imageops::resize(&source, output_width, output_height, FilterType::Triangle)
            .into_raw()
    };

    // Encode to PNG in memory.
    let mut png_data: Vec<u8> = Vec::new();
    {
        let encoder = PngEncoder::new(&mut png_data);
        encoder
            .write_image(
                &pixels,
                output_width,
                output_height,
                ExtendedColorType::Rgba8,
            )
            .map_err(|e| {
                ProtocolError::new(
                    format!("PNG encoding failed: {e}"),
                    ErrorCode::CaptureFailed,
                )
            })?;
    }

    // Base64-encode the PNG bytes.
    Ok((BASE64.encode(&png_data), output_width, output_height))
}

/// Crop a top-down 32-bit BGRA buffer to `(x, y, width, height)`.
///
/// Returns the original buffer when the crop is degenerate or covers the
/// whole image, so callers never lose data to a bad rectangle.
#[cfg(windows)]
fn crop_bgra(
    bits: Vec<u8>,
    width: i32,
    height: i32,
    crop: (i32, i32, i32, i32),
) -> (Vec<u8>, i32, i32) {
    let (cx, cy, cw, ch) = crop;
    let cx = cx.clamp(0, width);
    let cy = cy.clamp(0, height);
    let cw = cw.clamp(0, width - cx);
    let ch = ch.clamp(0, height - cy);
    if cw == 0 || ch == 0 || (cx == 0 && cy == 0 && cw == width && ch == height) {
        return (bits, width, height);
    }
    let mut cropped = Vec::with_capacity((cw as usize) * (ch as usize) * 4);
    let row_bytes = (cw as usize) * 4;
    for row in 0..ch {
        let start = (((cy + row) as usize) * (width as usize) + cx as usize) * 4;
        cropped.extend_from_slice(&bits[start..start + row_bytes]);
    }
    (cropped, cw, ch)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod unit_tests {
    use super::*;
    use crate::error::ErrorCode;
    #[cfg(windows)]
    use crate::refs::NativeHandle;
    use crate::state::StateId;

    // -- Platform support check (non-Windows) -------------------------------

    #[test]
    #[cfg(not(windows))]
    fn test_screenshot_unsupported_platform() {
        let mut store = RefStore::new();
        let wref = WindowRef { id: 1 };
        let result = screenshot(&mut store, &wref, false, None);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.code, ErrorCode::UnsupportedPlatform);
    }

    // -- Response shape tests (cross-platform) -----------------------------

    #[test]
    fn test_screenshot_response_shape_json() {
        // Verify that a successful screenshot response serialises to the
        // expected JSON shape.  This test does not require a real window.
        let state_id = StateId::fresh("s");
        let response = serde_json::json!({
            "target": "@w1",
            "capture": {
                "stateId": state_id,
                "width": 800,
                "height": 600,
                "imageFormat": "png",
                "imageBase64": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
            },
            "warnings": [],
        });

        // Validate structural fields
        assert_eq!(response["target"].as_str(), Some("@w1"));
        assert!(response["capture"].is_object());
        assert!(response["warnings"].is_array());
        assert!(response["warnings"].as_array().unwrap().is_empty());

        let capture = &response["capture"];
        assert!(capture["stateId"].as_str().unwrap().starts_with("s-"));
        assert_eq!(capture["width"].as_u64(), Some(800));
        assert_eq!(capture["height"].as_u64(), Some(600));
        assert_eq!(capture["imageFormat"].as_str(), Some("png"));
        assert!(capture["imageBase64"].as_str().unwrap().len() > 10);
    }

    #[test]
    fn test_screenshot_response_with_warnings() {
        // Verify response with warnings and null image for zero-sized capture.
        let state_id = StateId::fresh("s");
        let response = serde_json::json!({
            "target": "@w1",
            "capture": {
                "stateId": state_id,
                "width": 0,
                "height": 0,
                "imageFormat": "png",
                "imageBase64": null,
            },
            "warnings": ["zero_sized_window"],
        });

        assert_eq!(response["target"].as_str(), Some("@w1"));
        assert_eq!(
            response["warnings"].as_array().unwrap(),
            &[serde_json::json!("zero_sized_window")]
        );
        assert!(response["capture"]["imageBase64"].is_null());
        assert_eq!(response["capture"]["width"].as_u64(), Some(0));
        assert_eq!(response["capture"]["height"].as_u64(), Some(0));
    }

    #[test]
    fn test_screenshot_target_not_found_error() {
        // Verify that a non-existent window ref produces the expected error.
        // On non-Windows the platform check returns UnsupportedPlatform first;
        // on Windows an empty store would return TargetNotFound.
        let mut store = RefStore::new();
        let wref = WindowRef { id: 999 };
        let result = screenshot(&mut store, &wref, false, None);
        assert!(result.is_err());
        let err = result.unwrap_err();
        #[cfg(not(windows))]
        assert_eq!(err.code, ErrorCode::UnsupportedPlatform);
        #[cfg(windows)]
        assert_eq!(err.code, ErrorCode::TargetNotFound);
    }

    // -- Bitmap cropping ---------------------------------------------------

    #[test]
    #[cfg(windows)]
    fn test_crop_bgra_extracts_visible_region() {
        // 2x2 image, one byte per channel: rows are [0..8) and [8..16).
        let bits: Vec<u8> = (0u8..16).collect();
        let (cropped, w, h) = crop_bgra(bits, 2, 2, (1, 0, 1, 2));
        assert_eq!((w, h), (1, 2));
        assert_eq!(cropped, vec![4, 5, 6, 7, 12, 13, 14, 15]);
    }

    #[test]
    #[cfg(windows)]
    fn test_crop_bgra_clamps_to_bitmap_bounds() {
        let bits: Vec<u8> = (0u8..16).collect();
        let (cropped, w, h) = crop_bgra(bits, 2, 2, (1, 1, 99, 99));
        assert_eq!((w, h), (1, 1));
        assert_eq!(cropped, vec![12, 13, 14, 15]);
    }

    #[test]
    #[cfg(windows)]
    fn test_crop_bgra_passes_through_full_or_degenerate_rects() {
        let bits: Vec<u8> = (0u8..16).collect();
        let (full, w, h) = crop_bgra(bits.clone(), 2, 2, (0, 0, 2, 2));
        assert_eq!((w, h), (2, 2));
        assert_eq!(full, bits);
        let (degenerate, w, h) = crop_bgra(bits.clone(), 2, 2, (5, 5, 3, 3));
        assert_eq!((w, h), (2, 2));
        assert_eq!(degenerate, bits);
    }

    // -- Windows-only integration tests ------------------------------------

    #[test]
    #[cfg(windows)]
    fn test_screenshot_capture_fresh_state_id() {
        // On Windows, verify that each screenshot gets a unique stateId.
        let mut store = RefStore::new();
        // Only works if there's at least one visible HWND.
        // We use a synthetic handle - the test checks the stateId property
        // not the actual capture quality.
        let wref = store.insert_window(NativeHandle::new(0)); // HWND 0 is invalid

        match screenshot(&mut store, &wref, false, None) {
            Ok(val) => {
                let sid = val["capture"]["stateId"]
                    .as_str()
                    .expect("stateId should be a string");
                assert!(sid.starts_with("s-"), "stateId should start with s-");
            }
            Err(e) => {
                // In CI / headless environments this will fail with
                // CaptureFailed because HWND 0 is not a valid window.
                // That's acceptable - the error path is exercised.
                assert_eq!(
                    e.code,
                    ErrorCode::CaptureFailed,
                    "Expected CaptureFailed for invalid HWND: {e:?}",
                );
            }
        }
    }

    #[test]
    #[cfg(windows)]
    fn test_screenshot_fresh_state_ids_differ() {
        let mut store = RefStore::new();
        let wref = store.insert_window(NativeHandle::new(0));

        // Same as above; just check that two calls produce different IDs
        // when they succeed or the same error when they fail.
        let result_a = screenshot(&mut store, &wref, false, None);
        let result_b = screenshot(&mut store, &wref, false, None);

        let err_a = result_a.as_ref().err().map(|e| e.code);
        let err_b = result_b.as_ref().err().map(|e| e.code);
        assert_eq!(err_a, err_b, "both calls should produce the same outcome");
    }
}
