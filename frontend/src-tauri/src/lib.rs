use std::{
    net::{TcpStream, ToSocketAddrs},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

const BACKEND_URL: &str = "http://localhost:47778";
const BACKEND_HEALTH_URL: &str = "http://localhost:47778/api/health";
const BACKEND_HOST: &str = "localhost:47778";

#[derive(Clone, Default)]
struct BackendState {
    child: Arc<Mutex<Option<CommandChild>>>,
}

fn project_root() -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .and_then(|frontend| frontend.parent())
        .map(PathBuf::from)
        .ok_or_else(|| "failed to resolve project root".to_string())
}

fn backend_is_reachable() -> bool {
    let timeout = Duration::from_millis(500);
    match BACKEND_HOST.to_socket_addrs() {
        Ok(addrs) => addrs
            .into_iter()
            .any(|addr| TcpStream::connect_timeout(&addr, timeout).is_ok()),
        Err(err) => {
            eprintln!("[Tauri] Could not resolve {BACKEND_HOST}: {err}");
            false
        }
    }
}

fn log_backend_event(event: &CommandEvent) {
    match event {
        CommandEvent::Stdout(line) => {
            print!("[Tauri backend stdout] {}", String::from_utf8_lossy(line));
        }
        CommandEvent::Stderr(line) => {
            eprint!("[Tauri backend stderr] {}", String::from_utf8_lossy(line));
        }
        CommandEvent::Error(message) => {
            eprintln!("[Tauri backend error] {message}");
        }
        CommandEvent::Terminated(payload) => {
            println!("[Tauri] Backend process exited with code {:?}", payload.code);
        }
        _ => {}
    }
}

fn spawn_backend<R: tauri::Runtime>(app: &AppHandle<R>, state: &BackendState) -> Result<String, String> {
    let mut guard = state
        .child
        .lock()
        .map_err(|_| "backend state lock poisoned".to_string())?;
    if let Some(child) = guard.as_ref() {
        return Ok(format!(
            "backend already running at {BACKEND_URL} (pid {})",
            child.pid()
        ));
    }

    let root = project_root()?;
    let (mut events, child) = app
        .shell()
        .command("bun")
        .args(["run", "server"])
        .current_dir(root)
        .spawn()
        .map_err(|e| format!("failed to start backend: {e}"))?;
    let pid = child.pid();
    *guard = Some(child);

    let state_for_task = state.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            log_backend_event(&event);
            if matches!(&event, CommandEvent::Terminated(_) | CommandEvent::Error(_)) {
                if let Ok(mut child) = state_for_task.child.lock() {
                    if child.as_ref().is_some_and(|current| current.pid() == pid) {
                        *child = None;
                    }
                }
                break;
            }
        }
    });

    Ok(format!("backend started at {BACKEND_URL} (pid {pid})"))
}

#[tauri::command]
fn start_backend(app: AppHandle, state: State<BackendState>) -> Result<String, String> {
    if backend_is_reachable() {
        println!("[Tauri] Backend already reachable at {BACKEND_URL}");
        return Ok(format!("backend already reachable at {BACKEND_URL}"));
    }
    spawn_backend(&app, state.inner())
}

#[tauri::command]
fn stop_backend(state: State<BackendState>) -> Result<String, String> {
    let child = state
        .child
        .lock()
        .map_err(|_| "backend state lock poisoned".to_string())?
        .take();

    match child {
        Some(child) => {
            let pid = child.pid();
            child
                .kill()
                .map_err(|e| format!("failed to stop backend: {e}"))?;
            Ok(format!("backend stopped (pid {pid})"))
        }
        None => Ok("backend not running".to_string()),
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AboutInfo {
    version: &'static str,
    build_date: &'static str,
    platform: String,
}

#[tauri::command]
fn health_check() -> Result<String, String> {
    let resp = std::process::Command::new("curl")
        .args(["-s", "-o", "/dev/null", "-w", "%{http_code}", BACKEND_HEALTH_URL])
        .output()
        .map_err(|e| e.to_string())?;
    let status = String::from_utf8_lossy(&resp.stdout).to_string();
    Ok(status)
}

#[tauri::command]
fn get_about_info() -> AboutInfo {
    AboutInfo {
        version: env!("CARGO_PKG_VERSION"),
        build_date: option_env!("BUILD_DATE").unwrap_or("unknown"),
        platform: format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
    }
}

#[tauri::command]
fn get_backend_url() -> String {
    BACKEND_URL.to_string()
}

fn autostart_backend<R: tauri::Runtime>(app: &tauri::App<R>) {
    if backend_is_reachable() {
        println!("[Tauri] Backend already reachable at {BACKEND_URL}");
        return;
    }

    let handle = app.handle().clone();
    let state = app.state::<BackendState>().inner().clone();
    println!("[Tauri] Backend not reachable at {BACKEND_URL}; spawning `bun run server`");

    tauri::async_runtime::spawn(async move {
        match spawn_backend(&handle, &state) {
            Ok(message) => println!("[Tauri] {message}"),
            Err(err) => eprintln!("[Tauri] Failed to auto-start backend: {err}"),
        }
    });
}

pub fn run() {
    tauri::Builder::default()
        .manage(BackendState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            health_check,
            get_backend_url,
            get_about_info,
            start_backend,
            stop_backend,
        ])
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            window.set_title("ARRA Oracle").unwrap();
            autostart_backend(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
