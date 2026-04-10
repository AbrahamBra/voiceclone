#!/usr/bin/env node
// ============================================================
// CRITIC TEST RUNNER — Tests the critic check independently
// Usage: node eval/run-critic.js
// ============================================================

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";
import { criticCheck } from "../lib/critic.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const cases = JSON.parse(readFileSync(join(__dirname, "cases", "critic.json"), "utf-8"));
  const corrections = readFileSync(join(__dirname, "..", "knowledge", "meta", "corrections.md"), "utf-8");
  const client = new Anthropic();

  console.log(`\nCritic Test Suite — ${new Date().toISOString().slice(0, 19).replace("T", " ")}`);
  console.log(`Cases: ${cases.length}\n`);

  let passed = 0;
  let failed = 0;

  for (const tc of cases) {
    const label = `${tc.id} `;
    process.stdout.write(label);

    try {
      const verdict = await criticCheck(client, tc.input, corrections);
      const dots = ".".repeat(Math.max(1, 50 - label.length));

      // Check if critic behavior matches expectation
      const criticPassed = verdict.pass;
      const matchesExpectation = criticPassed === tc.expectPass;

      if (matchesExpectation) {
        console.log(`${dots} PASS (critic ${criticPassed ? "accepted" : "rejected"} as expected)`);
        passed++;
      } else {
        console.log(`${dots} FAIL (critic ${criticPassed ? "accepted" : "rejected"}, expected ${tc.expectPass ? "accept" : "reject"})`);
        if (verdict.violations.length > 0) {
          console.log(`  violations: ${verdict.violations.join(", ")}`);
        }
        failed++;
      }

      // Small delay between API calls
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      const dots = ".".repeat(Math.max(1, 50 - label.length));
      console.log(`${dots} ERROR: ${err.message}`);
      failed++;
    }
  }

  const total = passed + failed;
  console.log(`\nResults: ${passed}/${total} passed (${Math.round((passed / total) * 100)}%)\n`);
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
