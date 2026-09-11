//! Real socket regression: a peer that completes setup but stops reading must
//! not retain transport tasks or an unlimited number of pending IPC writes.
use super::*;
use serde_json::json;
use std::time::Duration;

#[test]
fn stalled_writes_are_bounded_and_close_releases_callers() {
    tauri::async_runtime::block_on(async {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("stalled.sock");
        let listener = tokio::net::UnixListener::bind(&path).unwrap();
        let (finish_peer, peer_done) = oneshot::channel::<()>();
        let peer = tauri::async_runtime::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            let _ws = tokio_tungstenite::accept_async(socket).await.unwrap();
            // Keep the real connection open without draining its receive buffer.
            let _ = peer_done.await;
        });
        let (events, mut received) = mpsc::unbounded_channel();
        let manager = Arc::new(TransportManager::new(Arc::new(move |event| {
            let _ = events.send(event);
        })));
        manager
            .open(&json!({
                "sessionId": "stalled",
                "target": {"transportType": "socket", "transportPath": path}
            }))
            .unwrap();
        let opened = tokio::time::timeout(Duration::from_secs(5), received.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(opened["kind"], "open");

        let writer = Arc::clone(&manager);
        let mut blocked = tauri::async_runtime::spawn(async move {
            writer
                .send(&json!({"sessionId": "stalled", "text": "x".repeat(8 * 1024 * 1024)}))
                .await
        });
        assert!(
            tokio::time::timeout(Duration::from_millis(200), &mut blocked)
                .await
                .is_err(),
            "the peer must actually back up the write before testing close"
        );

        // The in-flight 8 MiB is part of the 64 MiB budget: this payload fits
        // alone but cannot be admitted while that blocked write owns its bytes.
        let too_many_bytes = tokio::time::timeout(
            Duration::from_millis(200),
            manager.send(&json!({"sessionId": "stalled", "text": "y".repeat(57 * 1024 * 1024)})),
        )
        .await
        .expect("byte budget overflow should reject immediately")
        .unwrap_err();
        assert!(too_many_bytes.contains("byte budget is full"));

        let mut queued = Vec::new();
        // Poll each send once so admission happens without waiting for the peer.
        for _ in 0..MAX_PENDING_WRITES {
            let writer = Arc::clone(&manager);
            let mut send = Box::pin(async move {
                writer
                    .send(&json!({"sessionId": "stalled", "text": "queued"}))
                    .await
            });
            assert!(futures_util::poll!(&mut send).is_pending());
            queued.push(send);
        }
        let overflow = tokio::time::timeout(
            Duration::from_millis(200),
            manager.send(&json!({"sessionId": "stalled", "text": "overflow"})),
        )
        .await
        .expect("queue overflow should reject immediately")
        .unwrap_err();
        assert!(overflow.contains("queue is full"));

        manager.close(&json!({"sessionId": "stalled"})).unwrap();
        assert!(tokio::time::timeout(Duration::from_secs(2), blocked)
            .await
            .expect("closing must interrupt the blocked write")
            .unwrap()
            .is_err());
        for send in queued {
            assert!(tokio::time::timeout(Duration::from_secs(2), send)
                .await
                .expect("closing must reject queued callers")
                .is_err());
        }
        finish_peer.send(()).unwrap();
        peer.await.unwrap();
    });
}

#[test]
fn stalled_write_times_out_and_emits_connection_failure() {
    tauri::async_runtime::block_on(async {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("timeout.sock");
        let listener = tokio::net::UnixListener::bind(&path).unwrap();
        let (finish_peer, peer_done) = oneshot::channel::<()>();
        let peer = tauri::async_runtime::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            let _ws = tokio_tungstenite::accept_async(socket).await.unwrap();
            let _ = peer_done.await;
        });
        let (events, mut received) = mpsc::unbounded_channel();
        let manager = TransportManager::new(Arc::new(move |event| {
            let _ = events.send(event);
        }));
        manager
            .open(&json!({
                "sessionId": "timeout",
                "target": {"transportType": "socket", "transportPath": path}
            }))
            .unwrap();
        let opened = tokio::time::timeout(Duration::from_secs(5), received.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(opened["kind"], "open");
        let failure = tokio::time::timeout(
            Duration::from_secs(12),
            manager.send(&json!({"sessionId": "timeout", "text": "x".repeat(8 * 1024 * 1024)})),
        )
        .await
        .expect("write must eventually fail without user intervention")
        .unwrap_err();
        assert!(failure.contains("write timed out"));
        let error = tokio::time::timeout(Duration::from_secs(1), received.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(error["kind"], "error");
        assert_eq!(error["error"], failure);
        let closed = tokio::time::timeout(Duration::from_secs(1), received.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(closed["kind"], "close");
        assert_eq!(closed["code"], 1006);
        assert!(manager
            .send(&json!({"sessionId": "timeout", "text": "later"}))
            .await
            .unwrap_err()
            .contains("session not found"));
        finish_peer.send(()).unwrap();
        peer.await.unwrap();
    });
}
