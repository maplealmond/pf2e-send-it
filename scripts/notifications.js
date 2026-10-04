import { getStashActor, userIsRecipient, isSendItem } from "./party.js";
import { refreshPendingDialog } from "./dialogs.js";

const BATCH_WINDOW_MS = 500;
let refreshTimer = null;

function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refreshPendingDialog();
  }, BATCH_WINDOW_MS);
}

function isStashSendItem(item) {
  const stash = getStashActor();
  return stash && item.parent === stash && isSendItem(item);
}

export function registerCreateItemHook() {
  Hooks.on("createItem", (item) => {
    if (!isStashSendItem(item)) return;
    if (!userIsRecipient(item)) return;
    scheduleRefresh();
  });

  Hooks.on("deleteItem", (item) => {
    const stash = getStashActor();
    if (!stash || item.parent !== stash) return;
    scheduleRefresh();
  });

  Hooks.on("updateItem", (item) => {
    if (!isStashSendItem(item)) return;
    scheduleRefresh();
  });
}

export function showPendingOnReady() {
  refreshPendingDialog();
}
