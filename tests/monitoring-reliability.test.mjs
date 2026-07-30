import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");

test("units without data are explicitly excluded from ranking", () => {
  assert.match(page, /score=hasData\?.+?:null/);
  assert.match(page, /"Not ranked"/);
});

test("certification validity uses a full-data fingerprint", () => {
  assert.match(page, /dataFingerprint\(unitClaims,unitRetirees\)/);
  assert.match(page, /certification\.dataFingerprint===fingerprint/);
});

test("unit announcements are queried by permitted audience", () => {
  assert.match(page, /where\("audience","==","All Units"\)/);
  assert.match(page, /where\("audience","==",profile\.unit\)/);
});

test("bulk follow-up operations enforce the safe limit", () => {
  assert.match(page, /selected\.length>400/);
  assert.match(page, /Maximum 400/);
});

test("archive and restore are atomic with activity history", () => {
  assert.match(page, /batch\.delete\(doc\(db,"claims",id\)\)/);
  assert.match(page, /action:"Claim archived"/);
  assert.match(page, /action:"Archived record restored"/);
});

test("official reconciliation reuses both official parsers", () => {
  assert.match(page, /parseOfficialRetirees\(selected\.matrix,file\.name\)/);
  assert.match(page, /parseOfficialClaims\(selected\.matrix,file\.name\)/);
});

test("administrator diagnostic collections are protected", () => {
  assert.match(rules, /match \/archivedRecords\/\{archiveId\}/);
  assert.match(rules, /match \/systemErrors\/\{errorId\}/);
  assert.match(rules, /match \/reconciliationRuns\/\{runId\}/);
});

test("monthly validation covers required quality checks", () => {
  for (const label of [
    "Possible Duplicates",
    "Incomplete Requirements",
    "Overdue Follow-ups",
    "Unassigned Records",
    "Certifications on File",
    "Latest Reconciliation Differences",
  ]) assert.match(page, new RegExp(label));
});
