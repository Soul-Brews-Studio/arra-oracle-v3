use std::{net::{TcpStream, ToSocketAddrs}, path::PathBuf, sync::{Arc, Mutex}, time::Duration};
use tauri::{image::Image, menu::{Menu, MenuItem}, tray::TrayIconBuilder, AppHandle, Manager, State};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

mod app_menu;
mod mine;

const BACKEND_URL: &str = "http://localhost:47778";
const BACKEND_HEALTH_URL: &str = "http://localhost:47778/api/health";
const BACKEND_HOST: &str = "localhost:47778";
const TRAY_ID: &str = "backend-health";
const SHOW_WINDOW: &str = "show-window"; const START_BACKEND: &str = "start-backend";
const STOP_BACKEND: &str = "stop-backend"; const QUIT: &str = "quit";

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
    match BACKEND_HOST.to_socket_addrs() {
        Ok(addrs) => addrs.into_iter().any(|addr| TcpStream::connect_timeout(&addr, Duration::from_millis(500)).is_ok()),
        Err(err) => { eprintln!("[Tauri] Could not resolve {BACKEND_HOST}: {err}"); false }
    }
}

fn backend_status_icon(running: bool) -> Image<'static> {
    let color = if running { [46, 204, 113, 255] } else { [231, 76, 60, 255] };
    let mut rgba = vec![0; 32 * 32 * 4];
    for y in 0..32 { for x in 0..32 {
        let dx = x as i32 - 16; let dy = y as i32 - 16;
        if dx * dx + dy * dy <= 14 * 14 { rgba[((y * 32 + x) * 4)..((y * 32 + x) * 4 + 4)].copy_from_slice(&color); }
    }}
    Image::new_owned(rgba, 32, 32)
}

fn refresh_tray_status<R: tauri::Runtime>(app: &AppHandle<R>) {
    let running = backend_is_reachable();
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_icon(Some(backend_status_icon(running)));
        let _ = tray.set_tooltip(Some(if running { "ARRA backend running" } else { "ARRA backend stopped" }));
    }
}

fn show_main_window<R: tauri::Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn log_backend_event(event: &CommandEvent) {
    match event {
        CommandEvent::Stdout(line) => print!("[Tauri backend stdout] {}", String::from_utf8_lossy(line)),
        CommandEvent::Stderr(line) => eprint!("[Tauri backend stderr] {}", String::from_utf8_lossy(line)),
        CommandEvent::Error(message) => eprintln!("[Tauri backend error] {message}"),
        CommandEvent::Terminated(payload) => println!("[Tauri] Backend process exited with code {:?}", payload.code),
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
    let result = if backend_is_reachable() {
        println!("[Tauri] Backend already reachable at {BACKEND_URL}");
        Ok(format!("backend already reachable at {BACKEND_URL}"))
    } else {
        spawn_backend(&app, state.inner())
    };
    refresh_tray_status(&app);
    result
}

fn stop_backend_child(state: &BackendState) -> Result<String, String> {
    let child = state.child.lock().map_err(|_| "backend state lock poisoned".to_string())?.take();
    match child {
        Some(child) => {
            let pid = child.pid();
            child.kill().map_err(|e| format!("failed to stop backend: {e}"))?;
            Ok(format!("backend stopped (pid {pid})"))
        }
        None => Ok("backend not running".to_string()),
    }
}

#[tauri::command]
fn stop_backend(app: AppHandle, state: State<BackendState>) -> Result<String, String> {
    let result = stop_backend_child(state.inner());
    refresh_tray_status(&app);
    result
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
    let resp = std::process::Command::new("curl").args(["-s", "-o", "/dev/null", "-w", "%{http_code}", BACKEND_HEALTH_URL]).output().map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&resp.stdout).to_string())
}

#[tauri::command]
fn get_about_info() -> AboutInfo {
    AboutInfo { version: env!("CARGO_PKG_VERSION"), build_date: option_env!("BUILD_DATE").unwrap_or("unknown"), platform: format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH) }
}

#[tauri::command]
fn get_backend_url() -> String {
    BACKEND_URL.to_string()
}

fn setup_tray<R: tauri::Runtime + 'static>(app: &tauri::App<R>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, SHOW_WINDOW, "Show Window", true, None::<&str>)?;
    let start = MenuItem::with_id(app, START_BACKEND, "Start Backend", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, STOP_BACKEND, "Stop Backend", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT, "Quit", true, None::<&str>)?; let menu = Menu::with_items(app, &[&show, &start, &stop, &quit])?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(backend_status_icon(backend_is_reachable()))
        .tooltip("ARRA backend status")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            SHOW_WINDOW => show_main_window(app),
            START_BACKEND => {
                if !backend_is_reachable() {
                    let state = app.state::<BackendState>();
                    if let Err(err) = spawn_backend(app, state.inner()) { eprintln!("[Tauri] {err}"); }
                }
                refresh_tray_status(app);
            }
            STOP_BACKEND => {
                let state = app.state::<BackendState>();
                if let Err(err) = stop_backend_child(state.inner()) { eprintln!("[Tauri] {err}"); }
                refresh_tray_status(app);
            }
            QUIT => app.exit(0),
            _ => {}
        })
        .build(app)?;
    let handle = app.handle().clone();
    std::thread::spawn(move || loop { std::thread::sleep(Duration::from_secs(5)); refresh_tray_status(&handle); });
    Ok(())
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
        .on_menu_event(app_menu::handle_menu_event)
        .invoke_handler(tauri::generate_handler![
            health_check,
            get_backend_url,
            get_about_info,
            start_backend,
            stop_backend,
            mine::mine_folder,
        ])
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            window.set_title("ARRA Oracle").unwrap();
            setup_tray(app)?;
            app.set_menu(app_menu::build_app_menu(app.handle())?)?;
            autostart_backend(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
