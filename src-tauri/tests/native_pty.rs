//! Native PTY smoke test: no Claude, credentials, user files or network.
//! Exercises the installed OS PTY and real process exit, not the Tauri UI/IPC.
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::Read;

#[test]
fn short_lived_native_shell_preserves_initial_output_and_exit_code() {
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("native PTY must open");
    #[cfg(unix)]
    let cmd = {
        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.args(["-c", "printf 'orbit-native-fixture\\n'; exit 7"]);
        cmd
    };
    #[cfg(windows)]
    let cmd = {
        let mut cmd = CommandBuilder::new("cmd.exe");
        cmd.args(["/D", "/C", "echo orbit-native-fixture & exit /B 7"]);
        cmd
    };
    let mut reader = pair.master.try_clone_reader().expect("reader");
    let mut child = pair.slave.spawn_command(cmd).expect("fixture shell");
    drop(pair.slave);

    let mut output = Vec::new();
    let mut buffer = [0; 256];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => output.extend_from_slice(&buffer[..n]),
            #[cfg(unix)]
            Err(error) if error.raw_os_error() == Some(5) => break, // EIO after slave close
            Err(error) => panic!("native PTY read failed: {error}"),
        }
    }
    let status = child.wait().expect("shell exit");
    assert_eq!(status.exit_code(), 7);
    assert!(String::from_utf8_lossy(&output).contains("orbit-native-fixture"));
}
