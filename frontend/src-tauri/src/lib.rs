use tauri::Manager;

#[tauri::command]
fn health_check() -> Result<String, String> {
    let resp = std::process::Command::new("curl")
        .args(["-s", "-o", "/dev/null", "-w", "%{http_code}", "http://localhost:47778/api/health"])
        .output()
        .map_err(|e| e.to_string())?;
    let status = String::from_utf8_lossy(&resp.stdout).to_string();
    Ok(status)
}

#[tauri::command]
fn get_backend_url() -> String {
    "http://localhost:47778".to_string()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![health_check, get_backend_url])
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            window.set_title("ARRA Oracle").unwrap();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
