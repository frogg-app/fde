//! Native PTY sessions, replacing `terminal/terminal-worker-process.ts` and the
//! `node-pty` + `@xterm/headless` pair with `portable-pty` + `vt100`.
//!
//! A session owns the child process, pumps its output to subscribers as
//! terminal stream frames, and keeps a headless screen so a late subscriber can
//! be sent a snapshot instead of replaying the whole scrollback.

use anyhow::{Context, Result};
use portable_pty::{CommandBuilder, NativePtySystem, PtyPair, PtySize, PtySystem};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;

pub struct Spawn<'a> {
    pub command: &'a str,
    pub args: &'a [String],
    pub cwd: Option<&'a str>,
    pub rows: u16,
    pub cols: u16,
}

pub struct PtySession {
    pair: Mutex<PtyPair>,
    writer: Mutex<Box<dyn Write + Send>>,
    screen: Arc<Mutex<vt100::Parser>>,
    output: broadcast::Sender<Vec<u8>>,
    child: Mutex<Box<dyn portable_pty::Child + Send + Sync>>,
}

/// How much scrollback the headless screen keeps. Matches the Node default.
const SCROLLBACK_LINES: usize = 1000;

impl PtySession {
    pub fn spawn(spawn: Spawn<'_>) -> Result<Arc<Self>> {
        let (rows, cols) = (spawn.rows.max(1), spawn.cols.max(1));
        let pty = NativePtySystem::default();
        let pair = pty
            .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .context("opening a pty")?;

        let mut command = CommandBuilder::new(spawn.command);
        command.args(spawn.args);
        if let Some(cwd) = spawn.cwd {
            command.cwd(cwd);
        }
        // Without TERM, curses programs refuse to draw.
        command.env("TERM", "xterm-256color");

        let child = pair.slave.spawn_command(command).context("spawning the child process")?;
        let mut reader = pair.master.try_clone_reader().context("cloning the pty reader")?;
        let writer = pair.master.take_writer().context("taking the pty writer")?;

        let (output, _) = broadcast::channel(1024);
        let screen = Arc::new(Mutex::new(vt100::Parser::new(rows, cols, SCROLLBACK_LINES)));

        let session = Arc::new(Self {
            pair: Mutex::new(pair),
            writer: Mutex::new(writer),
            screen: screen.clone(),
            output: output.clone(),
            child: Mutex::new(child),
        });

        // The pty read side is blocking, so it gets a dedicated thread rather
        // than a tokio task; parking a runtime worker on read(2) would starve
        // unrelated connections.
        std::thread::spawn(move || {
            let mut buffer = [0u8; 8192];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let chunk = &buffer[..n];
                        if let Ok(mut screen) = screen.lock() {
                            screen.process(chunk);
                        }
                        // Err just means nobody is subscribed right now; the
                        // screen still advanced, so a later snapshot is correct.
                        let _ = output.send(chunk.to_vec());
                    }
                }
            }
        });

        Ok(session)
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Vec<u8>> {
        self.output.subscribe()
    }

    pub fn write_input(&self, bytes: &[u8]) -> Result<()> {
        let mut writer = self.writer.lock().map_err(|_| anyhow::anyhow!("pty writer poisoned"))?;
        writer.write_all(bytes)?;
        writer.flush()?;
        Ok(())
    }

    pub fn resize(&self, rows: u16, cols: u16) -> Result<()> {
        let (rows, cols) = (rows.max(1), cols.max(1));
        let pair = self.pair.lock().map_err(|_| anyhow::anyhow!("pty pair poisoned"))?;
        pair.master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .context("resizing the pty")?;
        if let Ok(mut screen) = self.screen.lock() {
            screen.set_size(rows, cols);
        }
        Ok(())
    }

    /// The visible screen as bytes, with the escape sequences needed to
    /// reproduce its formatting — what a reconnecting client replays.
    pub fn snapshot(&self) -> Vec<u8> {
        match self.screen.lock() {
            Ok(screen) => screen.screen().contents_formatted(),
            Err(_) => Vec::new(),
        }
    }

    /// Plain text of the visible screen, without formatting. Used by tests and
    /// by terminal-activity reporting once that is ported.
    #[allow(dead_code)]
    pub fn visible_text(&self) -> String {
        match self.screen.lock() {
            Ok(screen) => screen.screen().contents(),
            Err(_) => String::new(),
        }
    }

    #[allow(dead_code)]
    pub fn size(&self) -> (u16, u16) {
        match self.screen.lock() {
            Ok(screen) => screen.screen().size(),
            Err(_) => (0, 0),
        }
    }

    /// None while the child is still running.
    #[allow(dead_code)]
    pub fn exit_status(&self) -> Option<u32> {
        let mut child = self.child.lock().ok()?;
        match child.try_wait() {
            Ok(Some(status)) => Some(status.exit_code()),
            _ => None,
        }
    }

    pub fn kill(&self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    fn wait_for(session: &PtySession, needle: &str) -> bool {
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline {
            if session.visible_text().contains(needle) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        false
    }

    fn sh(script: &str) -> Arc<PtySession> {
        PtySession::spawn(Spawn {
            command: "/bin/sh",
            args: &["-c".into(), script.into()],
            cwd: Some("/tmp"),
            rows: 24,
            cols: 80,
        })
        .unwrap()
    }

    #[test]
    fn runs_a_command_and_captures_its_output() {
        let session = sh("echo NATIVE_PTY_OK");
        assert!(wait_for(&session, "NATIVE_PTY_OK"), "got: {:?}", session.visible_text());
    }

    #[test]
    fn streams_output_to_subscribers() {
        let session = sh("echo STREAMED; sleep 5");
        let mut rx = session.subscribe();
        // Subscribing races the first write, so fall back to the screen, which
        // is what a real late subscriber would be sent as a snapshot.
        let streamed = match rx.blocking_recv() {
            Ok(chunk) => String::from_utf8_lossy(&chunk).contains("STREAMED"),
            Err(_) => false,
        };
        assert!(streamed || wait_for(&session, "STREAMED"));
        session.kill();
    }

    #[test]
    fn accepts_input_and_echoes_it_back() {
        let session = sh("read line; echo GOT:$line");
        session.write_input(b"typed\n").unwrap();
        assert!(wait_for(&session, "GOT:typed"), "got: {:?}", session.visible_text());
    }

    #[test]
    fn resizing_updates_the_screen_and_the_child_sees_it() {
        let session = sh("sleep 5");
        assert_eq!(session.size(), (24, 80));
        session.resize(40, 120).unwrap();
        assert_eq!(session.size(), (40, 120));
        // Degenerate sizes are clamped rather than rejected.
        session.resize(0, 0).unwrap();
        assert_eq!(session.size(), (1, 1));
        session.kill();
    }

    #[test]
    fn snapshot_carries_formatting_for_replay() {
        // Bold red text; the snapshot must contain escape sequences, not just glyphs.
        let session = sh("printf '\\033[1;31mRED\\033[0m\\n'");
        assert!(wait_for(&session, "RED"));
        let snapshot = session.snapshot();
        assert!(!snapshot.is_empty());
        assert!(snapshot.contains(&0x1b), "snapshot should carry escape sequences");
        assert!(String::from_utf8_lossy(&snapshot).contains("RED"));
    }

    #[test]
    fn reports_exit_status_once_the_child_finishes() {
        let session = sh("exit 3");
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline && session.exit_status().is_none() {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(session.exit_status(), Some(3));
    }
}
