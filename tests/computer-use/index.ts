#!/usr/bin/env tsx
/**
 * Orbit E2E via Claude Computer Use
 *
 * Prérequis :
 *   brew install cliclick          # contrôle souris/clavier macOS
 *   export ANTHROPIC_API_KEY=...
 *
 * Usage :
 *   npx tsx tests/computer-use/index.ts
 *   npx tsx tests/computer-use/index.ts --scenario session
 *   npx tsx tests/computer-use/index.ts --reset
 *
 * Orbit est lancé automatiquement si nécessaire.
 */

import Anthropic from "@anthropic-ai/sdk";
import { execSync, execFileSync, spawn } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dirname, ".orbit-test-state.json");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Action =
  | { action: "screenshot" }
  | { action: "left_click"; coordinate: [number, number] }
  | { action: "double_click"; coordinate: [number, number] }
  | { action: "right_click"; coordinate: [number, number] }
  | { action: "type"; text: string }
  | { action: "key"; text: string }
  | { action: "scroll"; coordinate: [number, number]; scroll_direction: "up" | "down"; scroll_amount: number }
  | { action: "mouse_move"; coordinate: [number, number] }
  | { action: "wait" };

interface Scenario {
  name: string;
  prompt: string;
  setup?: string;
  maxActions?: number; // override de MAX_ACTIONS pour les scénarios complexes
}

interface TestResult {
  scenario: string;
  passed: boolean;
  summary: string;
  actions: number;
}

// ---------------------------------------------------------------------------
// Config — recommandations Anthropic Computer Use
// ---------------------------------------------------------------------------

const SCREENSHOT_PATH = join(tmpdir(), "orbit-cu-test.png");

// Résolution XGA recommandée par Anthropic — ne pas dépasser 1024×768
// pour éviter le redimensionnement côté API qui décale les coordonnées.
const DISPLAY_WIDTH = 1024;
const DISPLAY_HEIGHT = 768;

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 4096; // Recommandé par Anthropic pour Computer Use
const MAX_ACTIONS = 10;  // Limite par itération recommandée par Anthropic

// Dimensions logiques de l'écran (pixels logiques macOS, pas physiques Retina).
// Initialisées au démarrage — utilisées pour remonter les coordonnées Claude → cliclick.
let logicalScreen = { w: 1440, h: 900 };

// ---------------------------------------------------------------------------
// Initialisation écran
// ---------------------------------------------------------------------------

function initScreen(): void {
  try {
    // Finder retourne les bounds du bureau en coordonnées logiques (pas Retina 2×)
    const raw = execSync(
      `osascript -e 'tell application "Finder" to return bounds of window of desktop'`,
      { encoding: "utf8" }
    ).trim();
    // Format : "0, 0, 1440, 900"
    const parts = raw.split(",").map((s) => parseInt(s.trim()));
    logicalScreen = { w: parts[2], h: parts[3] };
  } catch {
    // Fallback 1440×900
  }
}

// Convertit les coordonnées Claude (espace 1024×768) → espace écran logique (cliclick).
// Sur Retina, screencapture capture en 2×/3× mais cliclick attend des pixels logiques.
function toScreen(x: number, y: number): [number, number] {
  return [
    Math.round((x / DISPLAY_WIDTH) * logicalScreen.w),
    Math.round((y / DISPLAY_HEIGHT) * logicalScreen.h),
  ];
}

// ---------------------------------------------------------------------------
// Lancement automatique d'Orbit
// ---------------------------------------------------------------------------

// Chemins possibles pour le binaire Orbit — uniquement /Applications (build officiel).
// Le build release local (src-tauri/target/release/...) est volontairement exclu :
// il peut être obsolète. Pour tester le code courant, utilise npm run tauri dev.
const ORBIT_APP_PATHS = [
  "/Applications/Orbit.app",
];

// PID du process tauri dev si on l'a lancé nous-mêmes (pour le cleanup)
let tauriDevPid: number | null = null;

function isOrbitRunning(): boolean {
  try {
    const out = execSync(
      `osascript -e 'tell application "System Events" to name of every process whose name contains "orbit"'`,
      { encoding: "utf8" }
    ).trim();
    return out.includes("orbit");
  } catch {
    return false;
  }
}

async function launchOrbitIfNeeded(): Promise<void> {
  if (isOrbitRunning()) {
    process.stdout.write("Orbit déjà lancé.\n\n");
    return;
  }

  // Cherche le build release ou /Applications
  const appPath = ORBIT_APP_PATHS.find(existsSync);

  if (appPath) {
    process.stdout.write(`Lancement d'Orbit (${appPath.includes("Applications") ? "Applications" : "build release"})...`);
    execSync(`open "${appPath}"`);
  } else {
    // Fallback : npm run tauri dev (lent, ~30s)
    process.stdout.write("Build non trouvé — lancement via npm run tauri dev (peut prendre ~30s)...\n");
    const proc = spawn("npm", ["run", "tauri", "dev"], {
      detached: true,
      stdio: "ignore",
      cwd: join(__dirname, "../.."),
    });
    proc.unref();
    tauriDevPid = proc.pid ?? null;
  }

  // Attend que le process orbit apparaisse (max 45s)
  const MAX_WAIT_S = 45;
  let ready = false;
  for (let i = 0; i < MAX_WAIT_S; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    process.stdout.write(".");
    if (isOrbitRunning()) { ready = true; break; }
  }

  if (!ready) {
    console.error("\n❌ Orbit n'a pas démarré dans les temps.");
    process.exit(1);
  }

  // Délai supplémentaire pour que l'UI soit complètement chargée
  process.stdout.write(" prêt, chargement UI");
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    process.stdout.write(".");
  }
  process.stdout.write("\n\n");
}

// ---------------------------------------------------------------------------
// Instruction de vérification — ajoutée à chaque prompt (recommandation Anthropic)
// ---------------------------------------------------------------------------

const VERIFY_INSTRUCTION = `
Après chaque action, prends un screenshot et évalue si tu as obtenu le résultat attendu.
Indique explicitement : "J'ai évalué l'étape X..." — si incorrect, réessaie.
Ne passe à l'étape suivante qu'une fois la précédente confirmée visuellement.`;

// ---------------------------------------------------------------------------
// Scénarios Orbit
// ---------------------------------------------------------------------------

const SCENARIOS: Record<string, Scenario> = {
  session: {
    name: "Création de session",
    prompt: `Orbit est ouvert (app dark, supervision Claude Code).
Prends un screenshot. Clique sur le bouton "+" (barre de tabs ou sidebar) pour créer une session.
Prends un screenshot. Si un menu de templates ou un dialog s'affiche (catégories PROJET/QUOTIDIEN/CONFIGURATION, ou boutons "Reprendre"/"Nouvelle session"/"Supprimer"), clique sur "Nouvelle session" ou sur le premier template disponible.
Prends un screenshot. Vérifie qu'un terminal xterm.js est visible (invite shell ou contenu de terminal noir avec texte).
${VERIFY_INSTRUCTION}
Réponds: PASS ou FAIL + une ligne.`,
  },

  rename: {
    name: "Renommage de session",
    setup: `Orbit est ouvert. Si aucune session n'est visible dans la sidebar, clique sur "+" pour en créer une. Si un menu apparaît, clique sur "Nouvelle session". PASS si une session existe maintenant, FAIL sinon.`,
    prompt: `Orbit est ouvert avec au moins une session dans la sidebar.
Prends un screenshot. Double-clique sur un nom de session dans la sidebar. Tape "Test Rename" puis Entrée.
Prends un screenshot. Vérifie que le nouveau nom "Test Rename" apparaît bien.
${VERIFY_INSTRUCTION}
Réponds: PASS ou FAIL + une ligne.`,
  },

  terminal_input: {
    name: "Saisie dans le terminal",
    setup: `Orbit est ouvert. Si aucun terminal n'est visible, clique sur "+" pour créer une session. Si un menu apparaît, clique sur "Nouvelle session" ou le premier template. PASS si un terminal est maintenant visible, FAIL sinon.`,
    prompt: `Orbit est ouvert avec un terminal actif.
Prends un screenshot. Clique dans le terminal. Tape "echo orbit-test-ok" puis Entrée.
Prends un screenshot (attends que la commande s'exécute). Vérifie que "orbit-test-ok" apparaît dans la sortie.
${VERIFY_INSTRUCTION}
Réponds: PASS ou FAIL + une ligne.`,
  },

  sidebar_navigate: {
    name: "Navigation sidebar",
    setup: `Orbit est ouvert. Compte les sessions dans la sidebar. S'il y en a moins de 2, clique sur "+" pour créer des sessions jusqu'à en avoir 2. PASS si 2+ sessions sont visibles, FAIL sinon.`,
    prompt: `Orbit est ouvert avec plusieurs sessions dans la sidebar.
Prends un screenshot. Note quelle session est active. Clique sur une session différente (inactive) dans la sidebar.
Prends un screenshot. Vérifie que l'affichage du terminal a changé.
${VERIFY_INSTRUCTION}
Réponds: PASS ou FAIL + une ligne.`,
  },

  theme: {
    name: "Changement de thème",
    maxActions: 20,
    prompt: `Orbit est ouvert.
Prends un screenshot et note la couleur de fond (dark/light/autre).
L'icône des préférences est un engrenage ⚙ en bas de la sidebar à gauche — clique dessus.
Prends un screenshot. Dans le panneau des préférences, trouve la section Thème et clique sur un thème différent de celui actuellement sélectionné.
Ferme les préférences (clic sur X ou Escape ou clic en dehors).
Prends un screenshot. Vérifie que la couleur de fond a changé par rapport au screenshot initial.
${VERIFY_INSTRUCTION}
Réponds: PASS ou FAIL + une ligne.`,
  },

  command_palette: {
    name: "Command palette",
    prompt: `Orbit est ouvert.
Prends un screenshot. Appuie sur Cmd+K pour ouvrir la command palette.
Prends un screenshot. Vérifie qu'une palette de commandes est visible. Appuie sur Escape pour fermer.
${VERIFY_INSTRUCTION}
Réponds: PASS ou FAIL + une ligne.`,
  },

  prompt_coach: {
    name: "Prompt Coach",
    maxActions: 15,
    prompt: `Orbit est ouvert.
Prends un screenshot. Cherche dans la sidebar gauche un bouton ou icône "Prompt Coach" ou une icône d'ampoule/crayon. Clique dessus.
Prends un screenshot. Vérifie qu'un panneau Prompt Coach s'est ouvert.
${VERIFY_INSTRUCTION}
Réponds: PASS ou FAIL + une ligne.`,
  },

  preferences: {
    name: "Préférences complètes",
    maxActions: 15,
    prompt: `Orbit est ouvert.
Prends un screenshot. L'icône des préférences est un engrenage ⚙ en bas de la sidebar gauche — clique dessus.
Prends un screenshot. Vérifie que le panneau des préférences est ouvert et que plusieurs sections sont visibles (thème, langue, ou autre).
${VERIFY_INSTRUCTION}
Réponds: PASS ou FAIL + une ligne.`,
  },
};

// ---------------------------------------------------------------------------
// Screenshot
// ---------------------------------------------------------------------------

function takeScreenshot(): string {
  // Orbit utilise WKWebView (Tauri) — non exposé à l'API Accessibility.
  // On capture le plein écran après avoir mis Orbit au premier plan.
  execSync(`osascript -e 'tell application "System Events" to tell process "orbit" to set frontmost to true' 2>/dev/null; true`);
  execSync(`screencapture -x "${SCREENSHOT_PATH}"`);

  // Redimensionne à 1024×768 (XGA) — résolution recommandée par Anthropic.
  // Sur Retina, screencapture capture en 2× (pixels physiques) ;
  // Claude doit recevoir 1024×768 pour que ses coordonnées correspondent à DISPLAY_WIDTH/HEIGHT.
  execSync(`sips -z ${DISPLAY_HEIGHT} ${DISPLAY_WIDTH} "${SCREENSHOT_PATH}" --out "${SCREENSHOT_PATH}" 2>/dev/null || true`);

  return readFileSync(SCREENSHOT_PATH).toString("base64");
}

// ---------------------------------------------------------------------------
// Exécution des actions Computer Use
// ---------------------------------------------------------------------------

// Actions qui modifient l'UI — on attend 500ms après pour laisser l'UI se mettre à jour
// avant que Claude ne prenne le prochain screenshot (recommandation Anthropic).
const UI_CHANGING_ACTIONS = new Set(["left_click", "double_click", "right_click", "type", "key", "scroll"]);

function executeAction(action: Action): unknown {
  let result: unknown;

  switch (action.action) {
    case "screenshot": {
      return {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: takeScreenshot() },
      };
    }

    case "left_click": {
      const [sx, sy] = toScreen(...action.coordinate);
      execFileSync("cliclick", [`c:${sx},${sy}`]);
      result = "clicked";
      break;
    }

    case "double_click": {
      const [sx, sy] = toScreen(...action.coordinate);
      execFileSync("cliclick", [`dc:${sx},${sy}`]);
      result = "double-clicked";
      break;
    }

    case "right_click": {
      const [sx, sy] = toScreen(...action.coordinate);
      execFileSync("cliclick", [`rc:${sx},${sy}`]);
      result = "right-clicked";
      break;
    }

    case "type": {
      const escaped = action.text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      execSync(`osascript -e 'tell application "System Events" to keystroke "${escaped}"'`);
      result = "typed";
      break;
    }

    case "key": {
      const keyCodeMap: Record<string, number> = {
        Return: 36, Enter: 36, Escape: 53, Tab: 48,
        BackSpace: 51, Delete: 117, space: 49,
        Up: 126, Down: 125, Left: 123, Right: 124,
      };
      const modifierMap: Record<string, string> = {
        cmd: "command down", command: "command down",
        ctrl: "control down", control: "control down",
        alt: "option down", option: "option down",
        shift: "shift down",
      };

      const parts = action.text.split("+");
      const mainKey = parts[parts.length - 1];
      const modifiers = parts.slice(0, -1)
        .map((m) => modifierMap[m.toLowerCase()])
        .filter(Boolean);

      if (modifiers.length > 0) {
        const modStr = `{${modifiers.join(", ")}}`;
        execSync(`osascript -e 'tell application "System Events" to keystroke "${mainKey.toLowerCase()}" using ${modStr}'`);
      } else if (mainKey in keyCodeMap) {
        execSync(`osascript -e 'tell application "System Events" to key code ${keyCodeMap[mainKey]}'`);
      } else {
        execSync(`osascript -e 'tell application "System Events" to keystroke "${mainKey.toLowerCase()}"'`);
      }
      result = "key sent";
      break;
    }

    case "scroll": {
      const [sx, sy] = toScreen(...action.coordinate);
      const dir = action.scroll_direction === "down" ? "wd" : "wu";
      const amount = Math.max(1, action.scroll_amount);
      for (let i = 0; i < amount; i++) {
        execFileSync("cliclick", [`${dir}:${sx},${sy}`]);
      }
      result = "scrolled";
      break;
    }

    case "mouse_move": {
      const [sx, sy] = toScreen(...action.coordinate);
      execFileSync("cliclick", [`m:${sx},${sy}`]);
      result = "moved";
      break;
    }

    case "wait": {
      execSync("sleep 1");
      result = "waited";
      break;
    }

    default:
      return "action non supportée";
  }

  // Délai après actions UI — laisse le temps à l'interface de se mettre à jour
  // avant que Claude ne prenne le prochain screenshot (recommandation Anthropic).
  if (UI_CHANGING_ACTIONS.has(action.action)) {
    execSync("sleep 0.5");
  }

  return result;
}

// ---------------------------------------------------------------------------
// Boucle agent
// ---------------------------------------------------------------------------

async function runAgentLoop(
  client: Anthropic,
  prompt: string,
  maxActions = MAX_ACTIONS
): Promise<{ passed: boolean; summary: string; actions: number }> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: prompt },
  ];

  let actionCount = 0;
  let finalText = "";

  while (true) {
    if (actionCount >= maxActions) {
      finalText = `FAIL dépassement de la limite de ${maxActions} actions`;
      break;
    }

    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      tools: [
        {
          type: "computer_20251124",
          name: "computer",
          display_width_px: DISPLAY_WIDTH,
          display_height_px: DISPLAY_HEIGHT,
        } as Anthropic.Beta.BetaToolComputerUse20251124,
      ],
      messages,
      betas: ["computer-use-2025-11-24"],
    });

    for (const block of response.content) {
      if (block.type === "text") finalText = block.text;
    }

    if (response.stop_reason === "end_turn") break;

    const toolResults: Anthropic.Beta.BetaToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      actionCount++;
      process.stdout.write(".");

      const input = block.input as Action;
      let content: Anthropic.Beta.BetaToolResultBlockParam["content"];

      try {
        const result = executeAction(input);
        content =
          typeof result === "object" && result !== null && "type" in result
            ? [result as Anthropic.Beta.BetaImageBlockParam]
            : String(result);
      } catch (err) {
        content = `Erreur: ${err instanceof Error ? err.message : String(err)}`;
      }

      toolResults.push({ type: "tool_result", tool_use_id: block.id, content });
    }

    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: toolResults });
  }

  const upper = finalText.toUpperCase();
  const passIdx = upper.indexOf("PASS");
  const failIdx = upper.indexOf("FAIL");
  const passed = passIdx !== -1 && (failIdx === -1 || passIdx < failIdx);
  const summary = finalText.replace(/^[\s\S]*?(PASS|FAIL)[,\s—]*/i, "").trim();
  return { passed, summary, actions: actionCount };
}

async function runScenario(client: Anthropic, scenario: Scenario): Promise<TestResult> {
  process.stdout.write(`  ▶ ${scenario.name} `);

  if (scenario.setup) {
    process.stdout.write("[setup] ");
    const setupResult = await runAgentLoop(client, scenario.setup, scenario.maxActions);
    if (!setupResult.passed) {
      process.stdout.write(" ✗\n");
      return {
        scenario: scenario.name,
        passed: false,
        summary: `setup échoué: ${setupResult.summary}`,
        actions: setupResult.actions,
      };
    }
  }

  const result = await runAgentLoop(client, scenario.prompt, scenario.maxActions);
  process.stdout.write(result.passed ? " ✓\n" : " ✗\n");

  return { scenario: scenario.name, ...result };
}

// ---------------------------------------------------------------------------
// State — persistance des résultats entre les runs
// ---------------------------------------------------------------------------

interface TestState {
  passed: string[];
}

function loadState(): TestState {
  if (!existsSync(STATE_FILE)) return { passed: [] };
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8")) as TestState;
  } catch {
    return { passed: [] };
  }
}

function saveState(state: TestState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  try {
    execSync("which cliclick", { stdio: "ignore" });
  } catch {
    console.error("❌ cliclick non trouvé — installe-le avec : brew install cliclick");
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ ANTHROPIC_API_KEY manquant");
    process.exit(1);
  }

  await launchOrbitIfNeeded();
  initScreen();

  const args = process.argv.slice(2);
  const resetFlag = args.includes("--reset");

  const scenarioArgIndex = process.argv.indexOf("--scenario");
  const scenarioArg = process.argv.find((a) => a.startsWith("--scenario="))?.split("=")[1]
    ?? (scenarioArgIndex !== -1 ? process.argv[scenarioArgIndex + 1] : undefined);

  if (resetFlag) {
    saveState({ passed: [] });
    console.log("État réinitialisé.\n");
  }

  const allScenarios = scenarioArg
    ? [SCENARIOS[scenarioArg]].filter(Boolean)
    : Object.values(SCENARIOS);

  if (allScenarios.length === 0) {
    console.error(`❌ Scénario inconnu: "${scenarioArg}". Disponibles: ${Object.keys(SCENARIOS).join(", ")}`);
    process.exit(1);
  }

  const state = loadState();
  const skipped = allScenarios.filter((s) => state.passed.includes(s.name));
  const toRun = allScenarios.filter((s) => !state.passed.includes(s.name));
  const total = allScenarios.length;

  console.log(`\nOrbit Computer Use — ${total} scénario(s) [${MODEL}] — écran ${logicalScreen.w}×${logicalScreen.h}`);
  if (skipped.length > 0) {
    console.log(`Reprise : ${skipped.length} déjà validé(s), ${toRun.length} à exécuter\n`);
  } else {
    console.log();
  }

  const client = new Anthropic();
  const results: TestResult[] = skipped.map((s) => ({
    scenario: s.name,
    passed: true,
    summary: "skipped (déjà validé)",
    actions: 0,
  }));

  for (const s of skipped) {
    console.log(`  ○ ${s.name} (skipped)`);
  }

  for (const scenario of toRun) {
    let result: TestResult;
    try {
      result = await runScenario(client, scenario);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result = { scenario: scenario.name, passed: false, summary: msg, actions: 0 };
      console.log(`  ✗ ${scenario.name} — erreur: ${msg}`);
    }

    results.push(result);

    if (result.passed) {
      state.passed.push(scenario.name);
      saveState(state);
    } else {
      if (result.summary && result.summary !== "skipped (déjà validé)") {
        console.log(`     → ${result.summary}`);
      }
      console.log(`\n⛔ Arrêt sur échec : ${scenario.name}`);
      console.log(`   Relance : npx tsx tests/computer-use/index.ts`);
      console.log(`   Reset   : npx tsx tests/computer-use/index.ts --reset\n`);
      process.exit(1);
    }
  }

  const passedCount = results.filter((r) => r.passed).length;
  console.log(`\n─────────────────────────────────`);
  console.log(`Résultat : ${passedCount}/${total} passés`);
  for (const r of results) {
    const isSkip = r.summary === "skipped (déjà validé)";
    const icon = r.passed ? (isSkip ? "○" : "✓") : "✗";
    const label = isSkip ? " (cache)" : ` (${r.actions} actions)`;
    console.log(`  ${icon} ${r.scenario}${label}`);
  }

  saveState({ passed: [] });
  console.log(`\nÉtat réinitialisé pour le prochain run.\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Erreur fatale:", err);
  process.exit(1);
});
