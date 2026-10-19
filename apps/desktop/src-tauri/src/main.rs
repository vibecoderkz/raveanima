// RaveAnima desktop shell. The editor itself runs in the webview (TypeScript core); Rust provides
// files, video encoding through ffmpeg, and the local bridge that lets AI agents drive the window.
//
// Developed by Dias Zhumagaliyev: https://dias.now. MIT License.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use rand::RngCore;
use serde_json::{json, Value};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Emitter, Manager, State};

const BRIDGE_PORT: u16 = 47900;
const BRIDGE_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_BODY: usize = 64 * 1024 * 1024;

#[derive(Default)]
struct Bridge {
    pending: Mutex<HashMap<String, mpsc::Sender<String>>>,
    port: Mutex<Option<u16>>,
    error: Mutex<Option<String>>,
}

#[derive(Default)]
struct Video {
    proc: Mutex<Option<(Child, ChildStdin)>>,
}

// ---------- files ----------

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("{path}: {e}"))
}

fn header_path(request: &Request) -> Result<String, String> {
    let raw = request
        .headers()
        .get("path")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing path header")?;
    Ok(percent_encoding::percent_decode_str(raw).decode_utf8_lossy().into_owned())
}

#[tauri::command]
fn write_binary_file(request: Request) -> Result<(), String> {
    let path = header_path(&request)?;
    match request.body() {
        InvokeBody::Raw(bytes) => std::fs::write(&path, bytes).map_err(|e| format!("{path}: {e}")),
        _ => Err("expected raw bytes".into()),
    }
}

// ---------- video export (raw RGBA frames piped into ffmpeg) ----------

fn encoder_args(format: &str) -> Result<Vec<&'static str>, String> {
    Ok(match format {
        "mp4" => vec!["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart"],
        "webm" => vec!["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "30"],
        "mov" => vec!["-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le"],
        "gif" => vec!["-vf", "split[a][b];[a]palettegen[p];[b][p]paletteuse=dither=sierra2_4a"],
        other => return Err(format!("unsupported video format {other}")),
    })
}

#[tauri::command]
fn video_start(video: State<Video>, path: String, width: u32, height: u32, fps: u32, format: String) -> Result<(), String> {
    let size = format!("{width}x{height}");
    let rate = fps.to_string();
    let mut args: Vec<&str> = vec!["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", &size, "-r", &rate, "-i", "-"];
    args.extend(encoder_args(&format)?);
    args.push(&path);
    let mut child = Command::new("ffmpeg")
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("ffmpeg is required for video export ({e}). Install it with your package manager."))?;
    let stdin = child.stdin.take().ok_or("ffmpeg stdin unavailable")?;
    *video.proc.lock().unwrap() = Some((child, stdin));
    Ok(())
}

#[tauri::command]
fn video_frame(video: State<Video>, request: Request) -> Result<(), String> {
    let mut guard = video.proc.lock().unwrap();
    let (_, stdin) = guard.as_mut().ok_or("no video export in progress")?;
    match request.body() {
        InvokeBody::Raw(bytes) => stdin.write_all(bytes).map_err(|e| format!("ffmpeg pipe: {e}")),
        _ => Err("expected raw RGBA bytes".into()),
    }
}

#[tauri::command]
fn video_finish(video: State<Video>) -> Result<(), String> {
    let (mut child, stdin) = video.proc.lock().unwrap().take().ok_or("no video export in progress")?;
    drop(stdin);
    let status = child.wait().map_err(|e| e.to_string())?;
    if status.success() {
        return Ok(());
    }
    let mut err = String::new();
    if let Some(mut s) = child.stderr.take() {
        let _ = s.read_to_string(&mut err);
    }
    Err(format!("ffmpeg failed: {}", err.trim()))
}

// ---------- agent bridge ----------

#[tauri::command]
fn bridge_reply(bridge: State<Arc<Bridge>>, id: String, reply: String) -> Result<(), String> {
    if let Some(tx) = bridge.pending.lock().unwrap().remove(&id) {
        let _ = tx.send(reply);
    }
    Ok(())
}

#[tauri::command]
fn bridge_info(bridge: State<Arc<Bridge>>) -> Result<Value, String> {
    match *bridge.port.lock().unwrap() {
        Some(port) => Ok(json!({ "port": port })),
        None => Err(bridge.error.lock().unwrap().clone().unwrap_or_else(|| "bridge not running".into())),
    }
}

fn token_path() -> std::path::PathBuf {
    dirs::config_dir().unwrap_or_else(std::env::temp_dir).join("anima").join("bridge.token")
}

fn write_token(token: &str) -> Result<(), String> {
    let path = token_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, token).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn respond(req: tiny_http::Request, status: u16, body: String) {
    let header = tiny_http::Header::from_bytes(&b"content-type"[..], &b"application/json"[..]).unwrap();
    let _ = req.respond(tiny_http::Response::from_string(body).with_status_code(status).with_header(header));
}

fn handle(mut req: tiny_http::Request, app: AppHandle, bridge: Arc<Bridge>, token: Arc<String>, seq: Arc<AtomicU64>) {
    let path = req.url().to_string();
    if req.method() == &tiny_http::Method::Get && path == "/health" {
        return respond(req, 200, json!({ "ok": true, "app": "anima", "version": env!("CARGO_PKG_VERSION") }).to_string());
    }
    if req.method() != &tiny_http::Method::Post || path != "/rpc" {
        return respond(req, 404, json!({ "ok": false, "error": "not found" }).to_string());
    }
    // Browsers attach Origin to cross-site requests; agents (CLI/MCP) never do. Refuse web pages outright.
    let has_origin = req.headers().iter().any(|h| h.field.equiv("origin"));
    let authorized = req
        .headers()
        .iter()
        .any(|h| h.field.equiv("authorization") && h.value.as_str() == format!("Bearer {}", token.as_str()));
    if has_origin || !authorized {
        return respond(req, 401, json!({ "ok": false, "error": "unauthorized" }).to_string());
    }
    let mut body = Vec::new();
    if req.as_reader().take(MAX_BODY as u64 + 1).read_to_end(&mut body).is_err() || body.len() > MAX_BODY {
        return respond(req, 413, json!({ "ok": false, "error": "body too large or unreadable" }).to_string());
    }
    let parsed: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => return respond(req, 400, json!({ "ok": false, "error": format!("invalid JSON: {e}") }).to_string()),
    };
    let id = format!("r{}", seq.fetch_add(1, Ordering::Relaxed));
    let (tx, rx) = mpsc::channel();
    bridge.pending.lock().unwrap().insert(id.clone(), tx);
    let payload = json!({ "id": id, "method": parsed["method"], "params": parsed["params"] });
    if let Err(e) = app.emit_to("main", "bridge-request", payload) {
        bridge.pending.lock().unwrap().remove(&id);
        return respond(req, 500, json!({ "ok": false, "error": e.to_string() }).to_string());
    }
    match rx.recv_timeout(BRIDGE_TIMEOUT) {
        Ok(reply) => respond(req, 200, reply),
        Err(_) => {
            bridge.pending.lock().unwrap().remove(&id);
            respond(req, 504, json!({ "ok": false, "error": "the RaveAnima window did not answer in time" }).to_string())
        }
    }
}

fn start_bridge(app: AppHandle, bridge: Arc<Bridge>) -> Result<u16, String> {
    let server = tiny_http::Server::http(("127.0.0.1", BRIDGE_PORT))
        .map_err(|e| format!("port {BRIDGE_PORT} is busy ({e}); is another RaveAnima window open?"))?;
    let mut bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut bytes);
    let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    write_token(&token)?;
    let token = Arc::new(token);
    let seq = Arc::new(AtomicU64::new(1));
    std::thread::spawn(move || {
        for req in server.incoming_requests() {
            let (app, bridge, token, seq) = (app.clone(), bridge.clone(), token.clone(), seq.clone());
            std::thread::spawn(move || handle(req, app, bridge, token, seq));
        }
    });
    Ok(BRIDGE_PORT)
}

fn main() {
    if std::env::args().any(|a| a == "--version" || a == "-V") {
        println!("RaveAnima {}\nDeveloped by Dias Zhumagaliyev: https://dias.now · hello@dias.now", env!("CARGO_PKG_VERSION"));
        return;
    }
    let bridge = Arc::new(Bridge::default());
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(bridge.clone())
        .manage(Video::default())
        .setup(move |app| {
            match start_bridge(app.handle().clone(), bridge.clone()) {
                Ok(port) => *bridge.port.lock().unwrap() = Some(port),
                Err(e) => {
                    eprintln!("raveanima bridge: {e}");
                    *bridge.error.lock().unwrap() = Some(e);
                }
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_title("RaveAnima");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            write_text_file,
            write_binary_file,
            video_start,
            video_frame,
            video_finish,
            bridge_reply,
            bridge_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running RaveAnima");
}
