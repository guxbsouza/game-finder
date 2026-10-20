import assert from "node:assert/strict";
import test from "node:test";
import {
  createMacAvailability,
  getAuthorizedUpdates,
  toCompletedUpdateResults,
  validatePreflightRows,
  valuesMatch,
} from "./apply-steam-platform-updates";

function makeUpdate(): any {
  return {
    verification: {
      internalGameId: "1030",
      expectedName: "LIMBO",
      candidateSteamAppId: "48000",
      current: {
        steam_app_id: null,
        platforms: ["Windows", "Linux", "Mac"],
        platform_availability: { Mac: "unknown" },
      },
    },
    current: {
      steam_app_id: null,
      platforms: ["Windows", "Linux", "Mac"],
      platform_availability: { Mac: "unknown" },
    },
    steamPlatforms: ["Windows", "Mac"],
  };
}

function makeRow(overrides: Record<string, unknown> = {}): any {
  return {
    id: "1030",
    name: "Limbo",
    steam_app_id: null,
    platforms: ["Windows", "Linux", "Mac"],
    platform_availability: { Mac: "unknown" },
    ...overrides,
  };
}

test("classifies an original snapshot as pending", () => {
  const result = validatePreflightRows([makeUpdate()], [makeRow()]);
  assert.equal(result.errors.length, 0);
  assert.equal(result.pendingUpdates.length, 1);
  assert.equal(result.completedUpdates.length, 0);
});

test("classifies an approved final state as completed", () => {
  const result = validatePreflightRows([makeUpdate()], [makeRow({
    steam_app_id: "48000",
    platform_availability: { Mac: "verified" },
  })]);
  assert.equal(result.errors.length, 0);
  assert.equal(result.pendingUpdates.length, 0);
  assert.equal(result.completedUpdates.length, 1);
});

test("rejects an unexpected state", () => {
  const result = validatePreflightRows([makeUpdate()], [makeRow({
    steam_app_id: "12345",
  })]);
  assert.deepEqual(result.errors, ["snapshot_divergente:1030"]);
  assert.equal(result.pendingUpdates.length, 0);
  assert.equal(result.completedUpdates.length, 0);
});

test("keeps blocked candidates out of authorized updates", () => {
  const result = getAuthorizedUpdates({
    catalogStatus: "sucesso",
    generatedAt: "test",
    results: [{
      expectedName: "Horizon Zero Dawn",
      internalGameId: "278",
      catalogName: "Horizon Zero Dawn",
      storedSteamAppId: null,
      current: null,
      candidateSteamAppId: "1151640",
      officialName: "Horizon Zero Dawn Complete Edition",
      productType: "game",
      steamPlatforms: ["Windows"],
      status: "revisao_manual",
      reason: "edicao_ambigua_requer_revisao_manual",
    }],
  });
  assert.equal(result.updates.length, 0);
  assert.equal(result.blocked.length, 1);
});

test("preserves non-Mac availability keys while changing only Mac", () => {
  assert.deepEqual(
    createMacAvailability({ Mac: "unknown", Windows: "verified", Linux: "unavailable" }, ["Windows", "Mac"]),
    { Mac: "verified", Windows: "verified", Linux: "unavailable" },
  );
});

test("matches objects regardless of key order", () => {
  assert.equal(
    valuesMatch({ Mac: "unknown", Windows: "verified" }, { Windows: "verified", Mac: "unknown" }),
    true,
  );
});

test("does not match arrays with different element order", () => {
  assert.equal(valuesMatch(["Windows", "Mac"], ["Mac", "Windows"]), false);
});

test("reports completed updates separately from pending updates", () => {
  const update = makeUpdate();
  const preflight = validatePreflightRows([update], [makeRow({
    steam_app_id: "48000",
    platform_availability: { Mac: "verified" },
  })]);
  const completed = toCompletedUpdateResults(preflight.completedUpdates);

  assert.equal(preflight.pendingUpdates.length, 0);
  assert.deepEqual(completed, [{
    internalGameId: "1030",
    expectedName: "LIMBO",
    candidateSteamAppId: "48000",
    status: "ja_atualizado",
  }]);
});
