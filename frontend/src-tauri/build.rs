use std::time::{SystemTime, UNIX_EPOCH};

fn main() {
    let build_date = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "unknown".to_string());
    println!("cargo:rustc-env=BUILD_DATE={build_date}");
    tauri_build::build()
}
