#!/usr/bin/env node
// ============================================================
// EVAL RUNNER — Sends test cases to the deployed API, runs checks
// Usage: node eval/run.js
//        node eval/run.js --case free-greeting
//        EVAL_API_URL=http://localhost:3000/api/chat node eval/run.js
// ============================================================

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { CHECKS } from "./checks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Default to localhost:3001 (matches .claude/launch.json --port 3001)
const API_URL = process.env.EVAL_API_URL || "http://localhost:3001/api/chat";
const ACCESS_CODE = process.env.ACCESS_CODE || "ahmet99";

// ============================================================
// SSE PARSER — Handles all 4 event types
// ============================================================

async function callAPI(scenario, messages, profileText) {
  const body = { scenario, messages };
  if (profileText) body.profileText = profileText;

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-access-code": ACCESS_CODE,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API returned ${response.status}: ${text}`);
  }

  const text = await response.text();
  let result = "";
  let error = null;

  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      const event = JSON.parse(line.slice(6));
      if (event.type === "delta") {
        result += event.text;
      } else if (event.type === "error") {
        error = event.text;
      }
      // "thinking" and "done" are ignored
    } catch {
      // Malformed JSON line, skip
    }
  }

  if (error) throw new Error(`API error: ${error}`);
  return result;
}

// ============================================================
// CHECK RUNNER
// ============================================================

function runChecks(response, checks) {
  const results = [];
  for (const check of checks) {
    const fn = CHECKS[check.type];
    if (!fn) {
      results.push({ type: check.type, pass: false, detail: `unknown check type` });
      continue;
    }
    const result = fn(response, check);
    results.push({ type: check.type, ...result });
  }
  return results;
}

// ============================================================
// SCORE CONSISTENCY — Special handling for runTwice cases
// ============================================================

function extractScore(response) {
  const match = response.match(/(\d+)\s*\/\s*12/);
  return match ? parseInt(match[1]) : null;
}

async function runScoreConsistency(testCase) {
  const tolerance = testCase._meta?.scoreTolerance || 2;
  const response1 = await callAPI(testCase.scenario, testCase.messages, testCase.profileText);
  const response2 = await callAPI(testCase.scenario, testCase.messages, testCase.profileText);

  const score1 = extractScore(response1);
  const score2 = extractScore(response2);

  const checkResults = runChecks(response1, testCase.checks);

  if (score1 !== null && score2 !== null) {
    const diff = Math.abs(score1 - score2);
    checkResults.push({
      type: "scoreConsistency",
      pass: diff <= tolerance,
      detail: diff <= tolerance
        ? `scores ${score1}/12 and ${score2}/12 (diff ${diff})`
        : `scores ${score1}/12 and ${score2}/12 (diff ${diff}, max ${tolerance})`,
    });
  } else {
    checkResults.push({
      type: "scoreConsistency",
      pass: false,
      detail: `could not extract scores: run1=${score1}, run2=${score2}`,
    });
  }

  return { response: response1, response2, checkResults };
}

// ============================================================
// UTILS
// ============================================================

const DELAY_MS = 2000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ============================================================
// MAIN
// ============================================================

async function main() {
  const caseFilter = process.argv.find((a) => a.startsWith("--case="))?.split("=")[1]
    || (process.argv.includes("--case") ? process.argv[process.argv.indexOf("--case") + 1] : null);

  // Load test cases
  const freeCases = JSON.parse(readFileSync(join(__dirname, "cases", "free.json"), "utf-8"));
  const analyzeCases = JSON.parse(readFileSync(join(__dirname, "cases", "analyze.json"), "utf-8"));
  let allCases = [...freeCases, ...analyzeCases];

  if (caseFilter) {
    allCases = allCases.filter((c) => c.id === caseFilter);
    if (allCases.length === 0) {
      console.error(`No case found with id "${caseFilter}"`);
      process.exit(1);
    }
  }

  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);

  console.log(`\nEval Suite — ${now.toISOString().slice(0, 19).replace("T", " ")}`);
  console.log(`API: ${API_URL}`);
  console.log(`Cases: ${allCases.length}\n`);

  const results = [];
  let passed = 0;
  let failed = 0;
  const failedIds = [];

  for (const testCase of allCases) {
    const label = `${testCase.id} `;
    process.stdout.write(label);

    try {
      let response, checkResults;

      if (testCase._meta?.runTwice) {
        const r = await runScoreConsistency(testCase);
        response = r.response;
        checkResults = r.checkResults;
      } else {
        response = await callAPI(testCase.scenario, testCase.messages, testCase.profileText);
        checkResults = runChecks(response, testCase.checks);
      }

      const allPassed = checkResults.every((r) => r.pass);
      const passCount = checkResults.filter((r) => r.pass).length;
      const totalCount = checkResults.length;

      const dots = ".".repeat(Math.max(1, 50 - label.length));

      if (allPassed) {
        console.log(`${dots} PASS (${passCount}/${totalCount})`);
        passed++;
      } else {
        console.log(`${dots} FAIL (${passCount}/${totalCount})`);
        for (const r of checkResults) {
          if (!r.pass) {
            console.log(`  x ${r.type}: ${r.detail || "failed"}`);
          }
        }
        failed++;
        failedIds.push(testCase.id);
      }

      results.push({
        id: testCase.id,
        name: testCase.name,
        scenario: testCase.scenario,
        pass: allPassed,
        response: response.slice(0, 2000),
        checks: checkResults,
      });

      // Delay between cases to avoid rate limiting
      await sleep(DELAY_MS);
    } catch (err) {
      const dots = ".".repeat(Math.max(1, 50 - label.length));
      console.log(`${dots} ERROR`);
      console.log(`  x ${err.message}`);
      failed++;
      failedIds.push(testCase.id);
      results.push({
        id: testCase.id,
        name: testCase.name,
        scenario: testCase.scenario,
        pass: false,
        error: err.message,
        checks: [],
      });
    }
  }

  // Summary
  const total = passed + failed;
  console.log(`\nResults: ${passed}/${total} passed (${Math.round((passed / total) * 100)}%)`);
  if (failedIds.length > 0) {
    console.log(`Failed: ${failedIds.join(", ")}`);
  }

  // Save results
  const resultsDir = join(__dirname, "results");
  mkdirSync(resultsDir, { recursive: true });
  const resultsPath = join(resultsDir, `${timestamp}.json`);
  writeFileSync(resultsPath, JSON.stringify({ ts: now.toISOString(), api: API_URL, summary: { passed, failed, total }, results }, null, 2));
  console.log(`Saved to: ${resultsPath}\n`);
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
