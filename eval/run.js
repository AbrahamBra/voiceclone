import { readFileSync } from "fs";
import { join } from "path";
import { ALL_CHECKS } from "./checks.js";

const API_BASE = process.env.API_BASE || "http://localhost:3000";
const ACCESS_CODE = process.env.ACCESS_CODE || "demo";

async function runChatTest(testCase) {
  const resp = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-access-code": ACCESS_CODE,
    },
    body: JSON.stringify({
      message: testCase.message,
      history: [],
      scenario: testCase.scenario,
    }),
  });

  if (!resp.ok) return { error: `HTTP ${resp.status}` };

  const text = await resp.text();
  let fullText = "";
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      const evt = JSON.parse(line.slice(6));
      if (evt.type === "delta") fullText += evt.text;
      if (evt.type === "clear") fullText = "";
    } catch { /* skip */ }
  }

  return { text: fullText };
}

async function runCriticTest(testCase) {
  const { criticCheck } = await import("../lib/pipeline.js");
  // criticCheck is sync and pure — no client needed. Kept the parameter for
  // forward-compat in case voice-aware variants want to call out to an LLM.
  const result = criticCheck(null, testCase.input, testCase.voiceRules || {});
  const passed = testCase.expectViolation ? !result.pass : result.pass;

  return {
    passed,
    detail: passed
      ? "OK"
      : `Expected violation=${testCase.expectViolation}, got pass=${result.pass} violations=${JSON.stringify(result.violations)}`,
  };
}

async function main() {
  // CLI: `node eval/run.js critic` to skip server-dependent suites; otherwise
  // all three. The critic-only mode is what CI / pre-PR validation uses since
  // it needs no running dev server.
  const onlyCritic = process.argv.includes("critic");
  const caseFiles = onlyCritic ? ["critic.json"] : ["free.json", "audit.json", "critic.json"];
  let total = 0, passed = 0, failed = 0;

  for (const file of caseFiles) {
    const cases = JSON.parse(readFileSync(join(process.cwd(), "eval", "cases", file), "utf-8"));
    console.log(`\n=== ${file} ===`);

    for (const tc of cases) {
      total++;
      process.stdout.write(`  ${tc.name}... `);

      try {
        if (tc.type === "critic") {
          const result = await runCriticTest(tc);
          if (result.passed) { console.log("PASS"); passed++; }
          else { console.log(`FAIL — ${result.detail}`); failed++; }
        } else {
          const result = await runChatTest(tc);
          if (result.error) { console.log(`FAIL — ${result.error}`); failed++; continue; }

          const checkResults = tc.checks.map((name) => ({ name, ...ALL_CHECKS[name](result.text) }));
          const allPass = checkResults.every((c) => c.pass);
          if (allPass) { console.log("PASS"); passed++; }
          else {
            const failures = checkResults.filter((c) => !c.pass);
            console.log(`FAIL — ${failures.map((f) => `${f.name}: ${f.detail}`).join("; ")}`);
            failed++;
          }
        }
      } catch (err) {
        console.log(`ERROR — ${err.message}`);
        failed++;
      }
    }
  }

  console.log(`\n--- Results: ${passed}/${total} passed, ${failed} failed ---`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
