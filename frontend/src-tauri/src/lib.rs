use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

const BACKEND_URL: &str = "http://localhost:47778";

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

#[tauri::command]
fn start_backend(app: AppHandle, state: State<BackendState>) -> Result<String, String> {
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

    let state_for_task = state.inner().clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            if matches!(event, CommandEvent::Terminated(_) | CommandEvent::Error(_)) {
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

#[tauri::command]
fn health_check() -> Result<String, String> {
    let resp = std::process::Command::new("curl")
        .args([
            "-s",
            "-o",
            "/dev/null",
            "-w",
            "%{http_code}",
            "http://localhost:47778/api/health",
        ])
        .output()
        .map_err(|e| e.to_string())?;
    let status = String::from_utf8_lossy(&resp.stdout).to_string();
    Ok(status)
}

#[tauri::command]
fn get_backend_url() -> String {
    BACKEND_URL.to_string()
}

pub fn run() {
    tauri::Builder::default()
        .manage(BackendState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            health_check,
            get_backend_url,
            start_backend,
            stop_backend,
        ])
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            window.set_title("ARRA Oracle").unwrap();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
