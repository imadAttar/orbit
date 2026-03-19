//! Structured logging with file rotation.
//!
//! Writes to ~/.orbit/logs/ with daily rotation, max 5 files.
//! PRIVACY: Never log prompt content, session transcripts, or user input.

use tracing_appender::rolling;
use tracing_subscriber::{fmt, EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};

/// Initialize the logging system. Call once at app startup.
pub fn init() {
    let home = super::pty::home_dir();
    let log_dir = std::path::Path::new(&home).join(".orbit").join("logs");
    let _ = std::fs::create_dir_all(&log_dir);

    // Daily rotation, keep max 5 files
    let file_appender = rolling::daily(&log_dir, "orbit.log");
    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

    // Leak the guard so it lives for the entire process
    std::mem::forget(_guard);

    // Clean up old log files (keep last 5)
    cleanup_old_logs(&log_dir, 5);

    tracing_subscriber::registry()
        .with(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("orbit_lib=info,warn")),
        )
        .with(
            fmt::layer()
                .with_writer(non_blocking)
                .with_ansi(false)
                .with_target(true)
                .with_thread_ids(false)
                .compact(),
        )
        .init();
}

/// Remove old log files, keeping only the most recent `keep` files.
fn cleanup_old_logs(dir: &std::path::Path, keep: usize) {
    let mut entries: Vec<_> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with("orbit.log"))
        })
        .collect();

    if entries.len() <= keep {
        return;
    }

    // Sort by modified time, oldest first
    entries.sort_by_key(|e| e.metadata().and_then(|m| m.modified()).unwrap_or(std::time::SystemTime::UNIX_EPOCH));

    for entry in entries.iter().take(entries.len() - keep) {
        let _ = std::fs::remove_file(entry.path());
    }
}
