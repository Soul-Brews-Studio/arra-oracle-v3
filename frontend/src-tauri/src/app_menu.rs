use tauri::{
    menu::{AboutMetadata, Menu, MenuBuilder, PredefinedMenuItem, SubmenuBuilder},
    AppHandle, Manager, Runtime,
};

const DOCS_URL: &str =
    "https://github.com/Soul-Brews-Studio/arra-oracle-v3/blob/alpha/docs/README.md";
const MENU_EXPORT_DATA: &str = "export_data";
const MENU_QUIT: &str = "quit";
const MENU_TOGGLE_FULLSCREEN: &str = "toggle_fullscreen";
const MENU_ALWAYS_ON_TOP: &str = "always_on_top";
const MENU_OPEN_DOCS: &str = "open_docs";

pub fn build_app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let about = PredefinedMenuItem::about(
        app,
        Some("About ARRA Oracle"),
        Some(AboutMetadata {
            name: Some("ARRA Oracle".into()),
            version: Some(env!("CARGO_PKG_VERSION").into()),
            ..Default::default()
        }),
    )?;
    let file = SubmenuBuilder::new(app, "File")
        .text(MENU_EXPORT_DATA, "Export Data")
        .separator()
        .text(MENU_QUIT, "Quit")
        .build()?;
    let view = SubmenuBuilder::new(app, "View")
        .text(MENU_TOGGLE_FULLSCREEN, "Toggle Fullscreen")
        .text(MENU_ALWAYS_ON_TOP, "Always on Top")
        .build()?;
    let help = SubmenuBuilder::new(app, "Help")
        .item(&about)
        .text(MENU_OPEN_DOCS, "Open Docs")
        .build()?;
    MenuBuilder::new(app)
        .item(&file)
        .item(&view)
        .item(&help)
        .build()
}

pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: tauri::menu::MenuEvent) {
    match event.id().as_ref() {
        MENU_EXPORT_DATA => open_export_page(app),
        MENU_QUIT => app.exit(0),
        MENU_TOGGLE_FULLSCREEN => toggle_fullscreen(app),
        MENU_ALWAYS_ON_TOP => toggle_always_on_top(app),
        MENU_OPEN_DOCS => {
            if let Err(err) = tauri_plugin_opener::open_url(DOCS_URL, None::<&str>) {
                eprintln!("[Tauri menu] open docs failed: {err}");
            }
        }
        _ => {}
    }
}

fn open_export_page<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let script = "window.history.pushState(null, '', '/export'); window.dispatchEvent(new PopStateEvent('popstate'));";
        if let Err(err) = window.eval(script) {
            eprintln!("[Tauri menu] navigation failed: {err}");
        }
    }
}

fn toggle_fullscreen<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        match window.is_fullscreen() {
            Ok(fullscreen) => {
                if let Err(err) = window.set_fullscreen(!fullscreen) {
                    eprintln!("[Tauri menu] fullscreen toggle failed: {err}");
                }
            }
            Err(err) => eprintln!("[Tauri menu] fullscreen state failed: {err}"),
        }
    }
}

fn toggle_always_on_top<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        match window.is_always_on_top() {
            Ok(on_top) => {
                if let Err(err) = window.set_always_on_top(!on_top) {
                    eprintln!("[Tauri menu] always-on-top toggle failed: {err}");
                }
            }
            Err(err) => eprintln!("[Tauri menu] always-on-top state failed: {err}"),
        }
    }
}
