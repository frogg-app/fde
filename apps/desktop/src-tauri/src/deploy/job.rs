//! One deploy job: ssh runs `... bash -s` on the host, the script goes in on
//! stdin, and every line of stdout/stderr comes back to the webview as a
//! `paseo:event:ssh-deploy-event` until the process exits or is cancelled.

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, Notify};

use crate::transport::ssh::format_ssh_failure;
use crate::transport::EventSink;

use super::args::SshTarget;
use super::ssh;

const STDERR_TAIL_LINES: usize = 20;

pub struct JobSpec {
    pub job_id: String,
    pub target: SshTarget,
    pub remote_command: String,
    pub script: &'static str,
    pub program: Option<PathBuf>,
}

#[derive(Clone, Copy)]
enum Stream {
    Stdout,
    Stderr,
}

impl Stream {
    fn name(self) -> &'static str {
        match self {
            Stream::Stdout => "stdout",
            Stream::Stderr => "stderr",
        }
    }
}

fn emit(sink: &EventSink, job_id: &str, kind: &str, extra: Value) {
    let mut payload = json!({ "jobId": job_id, "kind": kind });
    if let (Some(target), Some(extra)) = (payload.as_object_mut(), extra.as_object()) {
        for (key, value) in extra {
            target.insert(key.clone(), value.clone());
        }
    }
    (sink)(payload);
}

fn read_lines<R>(reader: R, stream: Stream, tx: mpsc::UnboundedSender<(Stream, String)>)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if tx.send((stream, line)).is_err() {
                break;
            }
        }
    });
}

/// Runs the job to completion. Resolves after the final `done`/`error`
/// event; the caller removes the job from the registry afterwards.
pub async fn run_job(spec: JobSpec, sink: EventSink, cancel: Arc<Notify>) {
    let job_id = spec.job_id.clone();
    let host = spec.target.host.clone();
    let (_, mut child) =
        match ssh::spawn(spec.program.as_deref(), &spec.target, &spec.remote_command) {
            Ok(spawned) => spawned,
            Err(error) => {
                log::warn!("deploy[{job_id}]: could not start ssh for {host}: {error}");
                emit(
                    &sink,
                    &job_id,
                    "error",
                    json!({ "detail": format!("Could not start ssh: {error}") }),
                );
                return;
            }
        };
    let (Some(mut stdin), Some(stdout), Some(stderr)) =
        (child.stdin.take(), child.stdout.take(), child.stderr.take())
    else {
        emit(
            &sink,
            &job_id,
            "error",
            json!({ "detail": "ssh stdio unavailable" }),
        );
        return;
    };
    let script = spec.script;
    tauri::async_runtime::spawn(async move {
        let _ = stdin.write_all(script.as_bytes()).await;
        let _ = stdin.shutdown().await;
    });
    let (tx, mut rx) = mpsc::unbounded_channel();
    read_lines(stdout, Stream::Stdout, tx.clone());
    read_lines(stderr, Stream::Stderr, tx);

    let mut stderr_tail: Vec<String> = Vec::new();
    let mut cancelled = false;
    loop {
        tokio::select! {
            next = rx.recv() => match next {
                Some((stream, line)) => {
                    log::info!("deploy[{job_id}] {}: {line}", stream.name());
                    if matches!(stream, Stream::Stderr) {
                        if stderr_tail.len() == STDERR_TAIL_LINES {
                            stderr_tail.remove(0);
                        }
                        stderr_tail.push(line.clone());
                    }
                    emit(&sink, &job_id, "log", json!({ "text": line, "stream": stream.name() }));
                }
                None => break,
            },
            _ = cancel.notified() => {
                cancelled = true;
                log::info!("deploy[{job_id}]: cancelled, killing ssh");
                let _ = child.kill().await;
                break;
            }
        }
    }
    if cancelled {
        let _ = child.wait().await;
        emit(
            &sink,
            &job_id,
            "error",
            json!({ "detail": "Cancelled", "cancelled": true }),
        );
        return;
    }
    match child.wait().await {
        Ok(status) if status.success() => {
            log::info!("deploy[{job_id}]: finished on {host}");
            emit(&sink, &job_id, "done", json!({ "text": "Finished" }));
        }
        Ok(status) => {
            let detail = format_ssh_failure(
                &stderr_tail.join("\n"),
                status.code(),
                ssh::exit_signal(&status),
            );
            log::warn!("deploy[{job_id}]: failed on {host}: {status}");
            emit(&sink, &job_id, "error", json!({ "detail": detail }));
        }
        Err(error) => {
            emit(
                &sink,
                &job_id,
                "error",
                json!({ "detail": error.to_string() }),
            );
        }
    }
}
