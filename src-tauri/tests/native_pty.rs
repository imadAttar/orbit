//! Native PTY smoke tests: no Claude, credentials, user files or network.
//! Every PTY operation (including wait/drop) lives in a disposable test process.
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{BufRead, BufReader, Read};
use std::process::{Command, ExitStatus, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

const SMOKE_TEST: &str = "short_lived_native_shell_preserves_initial_output_and_exit_code";
const WORKER_MODE: &str = "ORBIT_NATIVE_PTY_TEST_WORKER";
const HELD_OPEN: &str = "orbit-real-pty-held-open-before-read";
const MARKER: &str = "orbit-native-fixture";

#[test]
fn short_lived_native_shell_preserves_initial_output_and_exit_code() {
    match std::env::var(WORKER_MODE).as_deref() {
        Ok("smoke") => run_pty(false),
        Ok("held-open") => run_pty(true),
        Ok(mode) => panic!("unknown PTY worker mode: {mode}"),
        Err(_) => {
            let (status, output) = run_worker("smoke", Duration::from_secs(20))
                .unwrap_or_else(|error| panic!("{error}"));
            assert!(status.success(), "PTY worker failed: {status}\n{output}");
        }
    }
}

#[test]
fn watchdog_rejects_a_real_pty_that_never_closes() {
    let started = Instant::now();
    let error = run_worker("held-open", Duration::from_secs(5))
        .expect_err("a PTY held open must time out, not pass");
    assert!(error.contains("timed out"), "{error}");
    assert!(error.contains("terminated"), "{error}");
    // Prove the worker reached the real blocked read, rather than timing out
    // during process startup or failing to open a PTY.
    assert!(error.contains(HELD_OPEN), "{error}");
    assert!(started.elapsed() < Duration::from_secs(20));
}

/// Never wait/read/join synchronously in the supervising test process. Reserve
/// the last second of the total budget for killing and reaping the worker.
/// std::process::Child::drop does not wait, unlike PTY/ConPTY cleanup.
fn run_worker(mode: &str, budget: Duration) -> Result<(ExitStatus, String), String> {
    let deadline = Instant::now() + budget;
    let kill_at = deadline - Duration::from_secs(1);
    let mut child = Command::new(std::env::current_exe().expect("test executable"))
        .args(["--exact", SMOKE_TEST, "--nocapture", "--test-threads=1"])
        .env(WORKER_MODE, mode)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("start isolated PTY worker");
    let stdout = child.stdout.take().expect("worker stdout");
    let (send, receive) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) => {
                    if send.send(line).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
    let mut output = String::new();
    let mut timed_out = false;
    let mut status = None;
    loop {
        loop {
            match receive.try_recv() {
                Ok(line) => {
                    output.push_str(&line);
                    output.push('\n');
                }
                Err(mpsc::TryRecvError::Disconnected) if status.is_some() => {
                    // try_wait already observed/reaped exit, so wait returns
                    // its cached status without extending the deadline.
                    let exited = child.wait().expect("reap exited PTY worker");
                    return if timed_out {
                        Err(format!(
                            "PTY worker timed out and was terminated: {exited:?}\n{output}"
                        ))
                    } else {
                        Ok((exited, output))
                    };
                }
                Err(_) => break,
            }
        }
        status = child.try_wait().expect("poll PTY worker");
        if !timed_out && Instant::now() >= kill_at {
            timed_out = true;
            // This is the OS process handle, not portable-pty's child killer.
            child.kill().expect("kill timed-out PTY worker");
        }
        if Instant::now() >= deadline {
            // Keep even unusually slow OS cleanup off the supervising path,
            // while still retaining ownership until the process is reaped.
            std::thread::spawn(move || {
                let _ = child.kill();
                let _ = child.wait();
            });
            return Err(format!(
                "PTY worker timed out; cleanup deadline reached ({status:?})\n{output}"
            ));
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn run_pty(hold_open: bool) {
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
    if hold_open {
        println!("{HELD_OPEN}");
        std::io::Write::flush(&mut std::io::stdout()).expect("flush held-open handshake");
        // An actual OS PTY with both endpoints retained and no writer closing
        // the slave: read cannot finish. No shell descendant needs killing.
        let mut output = Vec::new();
        reader.read_to_end(&mut output).expect("held-open read");
        panic!("held-open PTY unexpectedly reached EOF");
    }
    let mut child = pair.slave.spawn_command(cmd).expect("fixture shell");
    drop(pair.slave);

    // Drain concurrently: ConPTY shutdown may need a reader to consume its
    // final output. The reader clone owns only a pipe handle, not the HPCON.
    let output_thread = std::thread::spawn(move || {
        let mut output = Vec::new();
        let mut buffer = [0; 256];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => output.extend_from_slice(&buffer[..n]),
                #[cfg(unix)]
                Err(error) if error.raw_os_error() == Some(5) => break, // slave closed
                Err(error) => panic!("native PTY read failed: {error}"),
            }
        }
        output
    });
    let status = child.wait().expect("shell exit");
    // portable-pty 0.8.1: the master keeps Inner.con alive on Windows;
    // PsuedoCon::drop calls ClosePseudoConsole. Shell exit alone is not EOF.
    // Close it while the reader is draining, BEFORE joining the EOF reader.
    drop(pair.master);
    let output = output_thread.join().expect("PTY output reader");
    assert_eq!(status.exit_code(), 7);
    assert!(String::from_utf8_lossy(&output).contains(MARKER));
}
