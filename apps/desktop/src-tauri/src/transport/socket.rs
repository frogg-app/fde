//! Local endpoints: a Unix domain socket or a Windows named pipe carrying the
//! daemon's WebSocket server (`ws+unix://<path>:/ws` in Electron's terms).

use std::io;
use std::pin::Pin;

use tokio::io::{AsyncRead, AsyncWrite};

/// Any duplex byte stream the WebSocket client can run over.
pub trait DuplexStream: AsyncRead + AsyncWrite + Send + Unpin {}
impl<T: AsyncRead + AsyncWrite + Send + Unpin> DuplexStream for T {}

pub type BoxedStream = Pin<Box<dyn DuplexStream>>;

#[cfg(unix)]
pub async fn connect_socket(path: &str) -> io::Result<BoxedStream> {
    let stream = tokio::net::UnixStream::connect(path).await?;
    Ok(Box::pin(stream))
}

#[cfg(not(unix))]
pub async fn connect_socket(_path: &str) -> io::Result<BoxedStream> {
    Err(io::Error::other(
        "Unix sockets are not supported on this platform.",
    ))
}

#[cfg(windows)]
pub async fn connect_pipe(path: &str) -> io::Result<BoxedStream> {
    use tokio::net::windows::named_pipe::ClientOptions;
    const ERROR_PIPE_BUSY: i32 = 231;
    // The server may momentarily have no free instance; retry as the
    // Windows API documents for CreateFile on a busy pipe.
    for _ in 0..20 {
        match ClientOptions::new().open(path) {
            Ok(client) => return Ok(Box::pin(client)),
            Err(error) if error.raw_os_error() == Some(ERROR_PIPE_BUSY) => {
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::other("Named pipe is busy."))
}

#[cfg(not(windows))]
pub async fn connect_pipe(_path: &str) -> io::Result<BoxedStream> {
    Err(io::Error::other(
        "Named pipes are only supported on Windows.",
    ))
}
