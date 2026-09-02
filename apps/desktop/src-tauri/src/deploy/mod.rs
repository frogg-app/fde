//! "Deploy daemon to this host" for Remote SSH hosts: probe the host, then
//! pipe `deploy/install.sh` (or `install-docker.sh`, `uninstall.sh`) into
//! `ssh <host> '... bash -s'` and stream its output to the webview. The
//! scripts download the release bundle on the remote themselves; nothing is
//! copied over with scp. See docs/desktop-shell.md, "SSH deploy".

pub mod args;
mod job;
pub mod probe;
pub mod scripts;
pub mod ssh;
#[cfg(all(test, unix))]
mod tests;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tokio::sync::Notify;

use crate::transport::EventSink;

use args::{DeployMethod, SshTarget};
use job::JobSpec;

pub const DEPLOY_EVENT: &str = "paseo:event:ssh-deploy-event";

type Jobs = Arc<Mutex<HashMap<String, Arc<Notify>>>>;

pub struct DeployManager {
    jobs: Jobs,
    emit: EventSink,
    next_job: AtomicU64,
    /// Pinned ssh executable (tests); `None` uses the transport's candidates.
    program: Option<PathBuf>,
}

fn lock(jobs: &Jobs) -> std::sync::MutexGuard<'_, HashMap<String, Arc<Notify>>> {
    jobs.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl DeployManager {
    pub fn new(emit: EventSink) -> Self {
        Self {
            jobs: Arc::new(Mutex::new(HashMap::new())),
            emit,
            next_job: AtomicU64::new(1),
            program: None,
        }
    }

    #[cfg(test)]
    pub fn with_program(emit: EventSink, program: PathBuf) -> Self {
        Self {
            program: Some(program),
            ..Self::new(emit)
        }
    }

    /// `ssh_deploy_probe {host, sshPort?}`.
    pub async fn probe(&self, args: &Value) -> Result<Value, String> {
        let target = args::parse_ssh_target(args)?;
        log::info!("deploy: probing {}", target.host);
        probe::run_probe(self.program.as_deref(), &target).await
    }

    /// `ssh_deploy_start {host, sshPort?, method?, version?, listen?, bundleUrl?}`.
    /// The version defaults to the app's own.
    pub fn start(&self, args: &Value, default_version: &str) -> Result<Value, String> {
        let request = args::parse_deploy_request(args, default_version)?;
        let script = match request.method {
            DeployMethod::Native => scripts::INSTALL_SH,
            DeployMethod::Docker => scripts::INSTALL_DOCKER_SH,
        };
        let remote_command = args::build_install_command(&request);
        log::info!(
            "deploy: starting {} install of {} on {} (listen {})",
            request.method.as_str(),
            request.version,
            request.target.host,
            request.listen
        );
        Ok(self.launch(request.target, remote_command, script))
    }

    /// `ssh_deploy_uninstall {host, sshPort?, method?}`.
    pub fn uninstall(&self, args: &Value) -> Result<Value, String> {
        let target = args::parse_ssh_target(args)?;
        let method = args::parse_method(args)?;
        let script = match method {
            DeployMethod::Native => scripts::UNINSTALL_SH,
            DeployMethod::Docker => scripts::UNINSTALL_DOCKER_SH,
        };
        log::info!(
            "deploy: starting {} uninstall on {}",
            method.as_str(),
            target.host
        );
        Ok(self.launch(target, "bash -s".to_string(), script))
    }

    /// `ssh_deploy_cancel {jobId}`: kills the ssh child; the job then emits
    /// its final `error` event with `cancelled: true`.
    pub fn cancel(&self, args: &Value) -> Result<Value, String> {
        let job_id = args
            .get("jobId")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .ok_or("jobId is required")?;
        match lock(&self.jobs).get(job_id) {
            Some(cancel) => {
                cancel.notify_one();
                Ok(json!({ "cancelled": true }))
            }
            None => Ok(json!({ "cancelled": false })),
        }
    }

    fn launch(&self, target: SshTarget, remote_command: String, script: &'static str) -> Value {
        let job_id = format!("deploy-{}", self.next_job.fetch_add(1, Ordering::Relaxed));
        let cancel = Arc::new(Notify::new());
        lock(&self.jobs).insert(job_id.clone(), Arc::clone(&cancel));
        let spec = JobSpec {
            job_id: job_id.clone(),
            target,
            remote_command,
            script,
            program: self.program.clone(),
        };
        let sink = Arc::clone(&self.emit);
        let jobs = Arc::clone(&self.jobs);
        let id = job_id.clone();
        tauri::async_runtime::spawn(async move {
            job::run_job(spec, sink, cancel).await;
            lock(&jobs).remove(&id);
        });
        json!({ "jobId": job_id })
    }

    /// Cancels every running job (app exit).
    pub fn cancel_all(&self) {
        for cancel in lock(&self.jobs).values() {
            cancel.notify_one();
        }
    }
}
