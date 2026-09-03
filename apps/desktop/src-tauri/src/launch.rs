//! Launch state: the pending open-project path (from argv) and the agent
//! navigation inbox (from `paseo://` deep links). Both are drained once by the
//! bridge, mirroring Electron's `pending-open-project-store.ts` and
//! `agent-navigation.ts` for the single main window.

use std::path::Path;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_deep_link::DeepLinkExt;

use crate::deep_link::{
    parse_agent_deep_link, parse_agent_deep_link_from_args, parse_pairing_deep_link,
    parse_pairing_deep_link_from_args, AgentDeepLinkTarget, PairingDeepLink,
};
use crate::window::MAIN_WINDOW_LABEL;

const OPEN_PROJECT_FLAG: &str = "--open-project";
const IGNORED_ARG_PREFIXES: &[&str] = &["-psn_", "--no-sandbox"];
pub const OPEN_PAIRING_OFFER_EVENT: &str = "paseo:event:open-pairing-offer";

pub struct LaunchState {
    pending_open_project: Mutex<Option<String>>,
    navigation: Mutex<AgentNavigationInbox>,
    pairing: Mutex<Inbox<PairingDeepLink>>,
}

#[derive(Default)]
struct AgentNavigationInbox {
    ready: bool,
    pending: Option<AgentDeepLinkTarget>,
}

/// Same handshake as the agent inbox, for one queued pairing offer: the page
/// declares itself ready (`pairing_offer_ready`) after registering its
/// `open-pairing-offer` listener, and anything that arrived earlier is handed
/// back from that call instead of being emitted into the void.
struct Inbox<T> {
    ready: bool,
    pending: Option<T>,
}

impl<T> Default for Inbox<T> {
    fn default() -> Self {
        Self {
            ready: false,
            pending: None,
        }
    }
}

impl LaunchState {
    pub fn from_argv(args: &[String]) -> Self {
        let mut navigation = AgentNavigationInbox::default();
        navigation.pending = parse_agent_deep_link_from_args(args);
        let mut pairing = Inbox::default();
        pairing.pending = parse_pairing_deep_link_from_args(args);
        Self {
            pending_open_project: Mutex::new(parse_open_project_path(args)),
            navigation: Mutex::new(navigation),
            pairing: Mutex::new(pairing),
        }
    }

    /// The page registered its `open-pairing-offer` listener; hand over anything queued.
    pub fn pairing_offer_ready(&self) -> Option<PairingDeepLink> {
        let mut inbox = self.pairing.lock().unwrap();
        inbox.ready = true;
        inbox.pending.take()
    }

    /// Returns the offer when the page can receive it now, otherwise queues it
    /// (a newer offer replaces an older queued one: claim tokens are single-use
    /// and short-lived, so only the latest is worth delivering).
    pub fn deliver_or_queue_pairing(&self, link: PairingDeepLink) -> Option<PairingDeepLink> {
        let mut inbox = self.pairing.lock().unwrap();
        if inbox.ready {
            Some(link)
        } else {
            inbox.pending = Some(link);
            None
        }
    }

    pub fn take_pending_open_project(&self) -> Option<String> {
        self.pending_open_project.lock().unwrap().take()
    }

    pub fn set_pending_open_project(&self, path: Option<String>) {
        *self.pending_open_project.lock().unwrap() = path.filter(|p| !p.trim().is_empty());
    }

    /// The page started loading (or reloading): its listeners are gone.
    pub fn window_loading(&self) {
        self.navigation.lock().unwrap().ready = false;
        self.pairing.lock().unwrap().ready = false;
    }

    /// The page registered its `open-agent` listener; hand over anything queued.
    pub fn window_ready(&self) -> Option<AgentDeepLinkTarget> {
        let mut inbox = self.navigation.lock().unwrap();
        inbox.ready = true;
        inbox.pending.take()
    }

    /// Returns the target when the page can receive it now, otherwise queues it.
    pub fn deliver_or_queue(&self, target: AgentDeepLinkTarget) -> Option<AgentDeepLinkTarget> {
        let mut inbox = self.navigation.lock().unwrap();
        if inbox.ready {
            Some(target)
        } else {
            inbox.pending = Some(target);
            None
        }
    }
}

fn is_existing_absolute_directory(candidate: &str) -> bool {
    let path = Path::new(candidate);
    path.is_absolute() && path.is_dir()
}

/// Mirrors Electron's `parseOpenProjectPathFromArgv`: the first positional
/// absolute directory wins, then `--open-project <dir>`.
pub fn parse_open_project_path(args: &[String]) -> Option<String> {
    let effective: Vec<&String> = args
        .iter()
        .skip(1)
        .filter(|arg| {
            !IGNORED_ARG_PREFIXES
                .iter()
                .any(|prefix| arg.starts_with(prefix))
        })
        .collect();

    if let Some(positional) = effective
        .iter()
        .find(|arg| !arg.starts_with('-') && is_existing_absolute_directory(arg))
    {
        return Some((*positional).clone());
    }

    let flag_index = effective
        .iter()
        .position(|arg| arg.as_str() == OPEN_PROJECT_FLAG)?;
    let flagged = effective.get(flag_index + 1)?;
    is_existing_absolute_directory(flagged).then(|| (*flagged).clone())
}

fn focus_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn receive_agent_deep_link<R: Runtime>(app: &AppHandle<R>, target: AgentDeepLinkTarget) {
    let state = app.state::<LaunchState>();
    if let Some(ready_target) = state.deliver_or_queue(target) {
        let _ = app.emit_to(MAIN_WINDOW_LABEL, "paseo:event:open-agent", ready_target);
    }
    focus_main_window(app);
}

/// A `paseo://pair#offer=…` link: the UI parses the offer and runs the claim
/// flow (`apps/ui/src/pairing/`), so only the raw URL crosses the bridge.
pub fn receive_pairing_deep_link<R: Runtime>(app: &AppHandle<R>, link: PairingDeepLink) {
    let state = app.state::<LaunchState>();
    if let Some(ready_link) = state.deliver_or_queue_pairing(link) {
        let _ = app.emit_to(MAIN_WINDOW_LABEL, OPEN_PAIRING_OFFER_EVENT, ready_link);
    }
    focus_main_window(app);
}

/// A second launch (`fde /path/to/project`, or an OS handing us a
/// `paseo://` link on Windows/Linux). Deep links in `argv` are forwarded to the
/// deep-link plugin by the single-instance plugin, so only paths are handled here.
pub fn handle_second_instance<R: Runtime>(app: &AppHandle<R>, argv: &[String]) {
    if parse_agent_deep_link_from_args(argv).is_some()
        || parse_pairing_deep_link_from_args(argv).is_some()
    {
        return;
    }
    if let Some(path) = parse_open_project_path(argv) {
        let state = app.state::<LaunchState>();
        state.set_pending_open_project(Some(path.clone()));
        let _ = app.emit_to(
            MAIN_WINDOW_LABEL,
            "paseo:event:open-project",
            serde_json::json!({ "path": path }),
        );
    }
    focus_main_window(app);
}

pub fn register_deep_link_handler<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    #[cfg(all(debug_assertions, any(windows, target_os = "linux")))]
    {
        // Packaged builds register the scheme through the bundler; dev builds
        // need to do it themselves.
        if let Err(error) = app.deep_link().register_all() {
            eprintln!("[deep-link] failed to register scheme: {error}");
        }
    }

    let handle = app.clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            if let Some(target) = parse_agent_deep_link(url.as_str()) {
                receive_agent_deep_link(&handle, target);
            } else if let Some(link) = parse_pairing_deep_link(url.as_str()) {
                receive_pairing_deep_link(&handle, link);
            }
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn positional_directory_becomes_pending_project() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_string_lossy().to_string();
        let state = LaunchState::from_argv(&args(&["fde", &path]));
        assert_eq!(
            state.take_pending_open_project().as_deref(),
            Some(path.as_str())
        );
        assert_eq!(state.take_pending_open_project(), None, "drained once");
    }

    #[test]
    fn open_project_flag_is_honoured() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_string_lossy().to_string();
        assert_eq!(
            parse_open_project_path(&args(&["fde", "--open-project", &path])),
            Some(path)
        );
    }

    #[test]
    fn missing_or_relative_paths_are_ignored() {
        assert_eq!(
            parse_open_project_path(&args(&["fde", "relative/dir"])),
            None
        );
        assert_eq!(
            parse_open_project_path(&args(&["fde", "/definitely/missing/dir"])),
            None
        );
        assert_eq!(parse_open_project_path(&args(&["fde", "-psn_0_1"])), None);
    }

    #[test]
    fn pairing_offer_queues_until_ready_then_delivers_directly() {
        let raw = "paseo://pair#offer=eyJ2IjozfQ";
        let state = LaunchState::from_argv(&args(&["fde", raw]));
        let link = PairingDeepLink {
            url: raw.to_string(),
        };
        assert_eq!(state.pairing_offer_ready(), Some(link.clone()));
        assert_eq!(state.pairing_offer_ready(), None, "drained once");
        assert_eq!(state.deliver_or_queue_pairing(link.clone()), Some(link.clone()));
        state.window_loading();
        assert_eq!(state.deliver_or_queue_pairing(link.clone()), None);
        let newer = PairingDeepLink {
            url: "paseo://pair#offer=newer".to_string(),
        };
        assert_eq!(state.deliver_or_queue_pairing(newer.clone()), None);
        assert_eq!(state.pairing_offer_ready(), Some(newer), "latest offer wins");
    }

    #[test]
    fn pairing_and_agent_links_do_not_cross_inboxes() {
        let state = LaunchState::from_argv(&args(&["fde", "paseo://pair#offer=abc"]));
        assert_eq!(state.window_ready(), None);
        assert!(state.pairing_offer_ready().is_some());
        let state = LaunchState::from_argv(&args(&["fde", "paseo://h/srv/agent/ag"]));
        assert_eq!(state.pairing_offer_ready(), None);
        assert!(state.window_ready().is_some());
    }

    #[test]
    fn navigation_queues_until_ready_then_delivers_directly() {
        let state = LaunchState::from_argv(&args(&["fde", "paseo://h/srv/agent/ag"]));
        let target = AgentDeepLinkTarget {
            server_id: "srv".into(),
            agent_id: "ag".into(),
        };
        assert_eq!(state.window_ready(), Some(target.clone()));
        assert_eq!(state.window_ready(), None);
        assert_eq!(state.deliver_or_queue(target.clone()), Some(target.clone()));
        state.window_loading();
        assert_eq!(state.deliver_or_queue(target.clone()), None);
        assert_eq!(state.window_ready(), Some(target));
    }
}
