import { MODULE_ID, FLAG, STATUS } from "./constants.js";
import {
  getStashActor,
  userIsRecipient,
  userOwnsActor,
  isSendItem,
  getItemFlag
} from "./party.js";
import { refreshPendingDialog } from "./dialogs.js";

const BATCH_WINDOW_MS = 500;
let refreshTimer = null;

function scheduleRefresh() {
  if (game.user.isGM) return;
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

function notifySenderOfAcceptance(item, userId) {
  if (game.user.isGM) return;
  if (userId === game.user.id) return;
  if (getItemFlag(item, FLAG.STATUS) !== STATUS.PENDING) return;
  const senderActor = game.actors.get(getItemFlag(item, FLAG.SENDER));
  if (!senderActor || !userOwnsActor(senderActor)) return;
  const recipientActor = game.actors.get(getItemFlag(item, FLAG.RECIPIENT));
  ui.notifications.info(game.i18n.format("PF2E_SEND_IT.AcceptedByRecipient", {
    recipient: recipientActor?.name ?? "They",
    item: item.name
  }));
}

export function registerCreateItemHook() {
  Hooks.on("createItem", (item) => {
    if (!isStashSendItem(item)) return;
    if (!userIsRecipient(item)) return;
    scheduleRefresh();
  });

  Hooks.on("deleteItem", (item, _options, userId) => {
    const stash = getStashActor();
    if (!stash || item.parent !== stash) return;
    if (isSendItem(item)) notifySenderOfAcceptance(item, userId);
    scheduleRefresh();
  });

  Hooks.on("updateItem", (item) => {
    if (!isStashSendItem(item)) return;
    scheduleRefresh();
  });
}

export function showPendingOnReady() {
  if (game.user.isGM) return;
  refreshPendingDialog();
}
