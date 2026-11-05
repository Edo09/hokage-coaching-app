/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MealItem } from "@/src/types/database";
import {
  afterFailedUpload,
  dropJob,
  isDuplicateUpload,
  jobAsOps,
  type PhotoJob,
  putJob,
} from "@/src/utils/photo-queue";

function job(registrationId: string): PhotoJob {
  return {
    registrationId,
    userId: "u1",
    localUri: `file:///queue/${registrationId}.jpg`,
    storagePath: "u1/p.jpg",
    mimeType: "image/jpeg",
    container: {
      id: "c1",
      user_id: "u1",
      name: "almuerzo",
      meal_type: "lunch",
      date: "2026-11-05",
      assigned_by: null,
      created_at: "2026-11-05T12:00:00Z",
      updated_at: "2026-11-05T12:00:00Z",
    },
    row: {
      id: registrationId,
      meal_id: "c1",
      user_id: "u1",
      name: "arroz con pollo",
      calories: 0,
      protein_g: 0,
      carbs_g: 0,
      fat_g: 0,
      portion: null,
      photo_path: "u1/p.jpg",
      plan_option_id: null,
      created_at: "2026-11-05T12:00:00Z",
      kind: "other",
      original_text: "arroz con pollo",
      estimate_status: "pending",
    },
    tries: 0,
  };
}

describe("photo queue rules", () => {
  it("one job per registration; cancel removes it (undo during upload)", () => {
    const a = job("r1");
    const b = { ...job("r1"), storagePath: "u1/new.jpg" };
    assert.deepEqual(putJob([a], b), [b]);
    assert.deepEqual(dropJob([b], "r1"), []);
  });
  it("gives up after three failed uploads", () => {
    let r = afterFailedUpload(job("r1"));
    assert.equal(r.giveUp, false);
    r = afterFailedUpload(r.job);
    r = afterFailedUpload(r.job);
    assert.equal(r.giveUp, true);
  });
  it("recognises a duplicate upload as stored", () => {
    assert.equal(isDuplicateUpload({ statusCode: "409" }), true);
    assert.equal(isDuplicateUpload(new Error("The resource already exists")), true);
    assert.equal(isDuplicateUpload({ statusCode: "500" }), false);
  });
  it("hands the row over as a container insert then a row upsert, photo path set", () => {
    const [c, r] = jobAsOps(job("r1"));
    assert.deepEqual(
      [c.table, c.kind, r.table, r.kind, (r.payload as MealItem).photo_path],
      ["meals", "insert", "meal_items", "upsert", "u1/p.jpg"],
    );
    assert.equal("meal_items" in c.payload, false);
  });
  it("hands the row over without its photo when the upload is given up", () => {
    const [, r] = jobAsOps(job("r1"), null);
    assert.equal((r.payload as MealItem).photo_path, null);
  });
});
