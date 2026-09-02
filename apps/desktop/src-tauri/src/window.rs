//! Main window creation and bridge injection.

use serde_json::json;
use tauri::{App, WebviewUrl, WebviewWindowBuilder};

pub const MAIN_WINDOW_LABEL: &str = "main";
const WINDOW_TITLE: &str = "Frogg DE";

const BRIDGE_SCRIPT: &str = include_str!("../bridge.js");

/// Matches `DesktopWindowChromeMode` in `apps/ui/src/desktop/host.ts`.
pub fn window_chrome_mode() -> &'static str {
    match std::env::consts::OS {
        "macos" => "native-mac",
        "windows" => "custom-windows",
        _ => "custom-linux",
    }
}

/// Electron-style platform names, which is what the UI still checks for.
pub fn electron_platform_name() -> &'static str {
    match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    }
}

pub fn build_init_script(app_version: &str) -> String {
    let host = json!({
        "platform": electron_platform_name(),
        "windowChromeMode": window_chrome_mode(),
        "appVersion": app_version,
        "windowLabel": MAIN_WINDOW_LABEL,
    });
    format!("window.__FROGG_DESKTOP_HOST__ = {host};\n{BRIDGE_SCRIPT}")
}

pub fn create_main_window(app: &App) -> tauri::Result<()> {
    let script = build_init_script(&app.package_info().version.to_string());
    let native_decorations = window_chrome_mode() == "native-mac";

    let builder = WebviewWindowBuilder::new(app, MAIN_WINDOW_LABEL, WebviewUrl::default())
        .title(WINDOW_TITLE)
        .inner_size(1280.0, 820.0)
        .min_inner_size(640.0, 480.0)
        .decorations(native_decorations)
        .initialization_script(script);

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    builder.build()?;
    Ok(())
}
