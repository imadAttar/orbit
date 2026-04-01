import os from "os";
import path from "path";
import { existsSync } from "fs";
import { spawn, spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

let tauriDriver: ReturnType<typeof spawn> | null = null;
let exiting = false;

function closeTauriDriver() {
  exiting = true;
  tauriDriver?.kill();
}

(["exit", "SIGINT", "SIGTERM", "SIGHUP"] as NodeJS.Signals[]).forEach((signal) => {
  process.on(signal, () => {
    closeTauriDriver();
    process.exit(0);
  });
});

export const config = {
  // tauri-driver écoute sur 127.0.0.1:4444
  hostname: "127.0.0.1",
  port: 4444,
  path: "/",

  specs: ["./tests/e2e/specs/**/*.spec.ts"],
  maxInstances: 1,

  capabilities: [
    {
      maxInstances: 1,
      browserName: "",
      "tauri:options": {
        application: path.resolve(__dirname, "src-tauri/target/debug/orbit"),
      },
    },
  ],

  logLevel: "warn" as const,
  bail: 0,
  waitforTimeout: 10000,
  connectionRetryTimeout: 30000,
  connectionRetryCount: 3,

  reporters: ["spec"],
  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    timeout: 30000,
  },

  // Build debug si le binaire n'existe pas
  onPrepare: () => {
    const binary = path.resolve(__dirname, "src-tauri/target/debug/orbit");
    if (!existsSync(binary)) {
      console.log("Binaire debug absent — build en cours (peut prendre ~2min)...");
      spawnSync("npm", ["run", "tauri", "build", "--", "--debug", "--no-bundle"], {
        cwd: path.resolve(__dirname),
        stdio: "inherit",
        shell: true,
      });
    }
  },

  // Démarre tauri-driver avant chaque session WebDriver
  beforeSession: () => {
    tauriDriver = spawn(
      path.resolve(os.homedir(), ".cargo", "bin", "tauri-driver"),
      [],
      { stdio: [null, process.stdout, process.stderr] }
    );

    tauriDriver.on("error", (err) => {
      console.error("tauri-driver error:", err);
      process.exit(1);
    });

    tauriDriver.on("exit", (code) => {
      if (!exiting) {
        console.error(`tauri-driver s'est arrêté avec le code ${code}`);
        process.exit(1);
      }
    });
  },

  // Arrête tauri-driver après chaque session
  afterSession: () => {
    closeTauriDriver();
  },
};
