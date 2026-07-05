use std::path::PathBuf;
use tauri::{AppHandle, Runtime};
use tauri_plugin_shell::ShellExt;

use crate::project_root;

#[tauri::command]
pub async fn mine_folder<R: Runtime>(app: AppHandle<R>, dir: String) -> Result<String, String> {
    let target = dir.trim();
    if target.is_empty() {
        return Err("folder path is required".to_string());
    }

    let folder = PathBuf::from(target);
    if !folder.exists() {
        return Err(format!("folder does not exist: {target}"));
    }
    if !folder.is_dir() {
        return Err(format!("folder path must be a directory: {target}"));
    }

    let output = app
        .shell()
        .command("bun")
        .args(["cli/src/cli.ts", "mine", target])
        .current_dir(project_root()?)
        .output()
        .await
        .map_err(|err| format!("failed to run arra mine: {err}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if output.status.success() {
        return Ok(if stdout.is_empty() { "Folder indexed.".to_string() } else { stdout });
    }

    let detail = if stderr.is_empty() { stdout } else { stderr };
    Err(if detail.is_empty() {
        format!("arra mine exited with status {:?}", output.status.code())
    } else {
        detail
    })
}
