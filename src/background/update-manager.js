import { setUpdateNotice } from "../lib/storage.js";

const GITHUB_RELEASES_URL = "https://github.com/dsahakyan15/Dowe/releases";

let pendingUpdate = null;
let isBusy = () => false;

function releaseUrl(version) {
  return `${GITHUB_RELEASES_URL}/tag/v${version}`;
}

function applyPendingUpdateIfIdle() {
  if (!pendingUpdate || isBusy()) return;
  pendingUpdate = null;
  chrome.runtime.reload();
}

async function markVersionAsUpdated(previousVersion) {
  // Reloading an unpacked extension also reports reason="update". It cannot
  // receive a store update, so do not show a misleading release notice during
  // local development. getSelf() needs no additional manifest permission.
  const self = await chrome.management.getSelf();
  if (self.installType === "development") return;

  const currentVersion = chrome.runtime.getManifest().version;
  await setUpdateNotice({
    version: currentVersion,
    previousVersion: previousVersion || "",
    releaseUrl: releaseUrl(currentVersion),
    installedAt: new Date().toISOString(),
  });
  await Promise.all([
    chrome.action.setBadgeBackgroundColor({ color: "#7655c5" }),
    chrome.action.setBadgeText({ text: "NEW" }),
  ]);
}

export function setupUpdateManager(options = {}) {
  isBusy = options.isBusy || isBusy;

  chrome.runtime.onUpdateAvailable.addListener((details) => {
    pendingUpdate = details;
    applyPendingUpdateIfIdle();
  });

  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === "update") {
      markVersionAsUpdated(details.previousVersion).catch(() => {});
    }
  });
}

export function applyUpdateWhenIdle() {
  applyPendingUpdateIfIdle();
}
