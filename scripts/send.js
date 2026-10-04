import { MODULE_ID, FLAG, STATUS } from "./constants.js";
import { getStashActor, getItemFlag, isSendItem } from "./party.js";
import { isCoinPackage, acceptCoinPackage, cancelCoinPackage } from "./coins.js";

async function removeFromSource(sourceItem, qty) {
  const current = sourceItem.system?.quantity ?? 1;
  if (qty >= current) {
    await sourceItem.delete();
  } else {
    await sourceItem.update({ "system.quantity": current - qty });
  }
}

function sameItemIdentity(existing, incoming) {
  const slugA = existing.system?.slug ?? null;
  const slugB = incoming.system?.slug ?? null;
  if (slugA && slugB) return slugA === slugB;
  const srcA = existing.flags?.core?.sourceId ?? null;
  const srcB = incoming.flags?.core?.sourceId ?? null;
  if (srcA && srcB) return srcA === srcB;
  return existing.name === incoming.name;
}

function findStackMatch(actor, itemData) {
  return actor.items.find(i =>
    !isSendItem(i) &&
    i.system?.quantity != null &&
    sameItemIdentity(i, itemData)
  );
}

export function findPendingSendStack(stash, senderId, recipientId, incoming) {
  return stash.items.find(i =>
    isSendItem(i) &&
    i.getFlag(MODULE_ID, FLAG.SENDER) === senderId &&
    i.getFlag(MODULE_ID, FLAG.RECIPIENT) === recipientId &&
    i.getFlag(MODULE_ID, FLAG.STATUS) === STATUS.PENDING &&
    i.system?.quantity != null &&
    sameItemIdentity(i, incoming)
  );
}

async function addToActor(actor, itemData, qty) {
  const existing = findStackMatch(actor, itemData);
  if (existing) {
    await existing.update({ "system.quantity": (existing.system.quantity ?? 0) + qty });
    return existing;
  }
  const data = foundry.utils.deepClone(itemData);
  if (data.system?.quantity != null) data.system.quantity = qty;
  delete data._id;
  delete data.flags?.[MODULE_ID];
  const [created] = await actor.createEmbeddedDocuments("Item", [data]);
  return created;
}

export async function sendItem({ sourceItem, recipientActor, quantity }) {
  const stash = getStashActor();
  if (!stash) {
    ui.notifications.error(game.i18n.localize("PF2E_SEND_IT.NoStash"));
    return;
  }
  const sender = sourceItem.actor;
  if (!sender) return;

  const max = sourceItem.system?.quantity ?? 1;
  const qty = Math.max(1, Math.min(quantity ?? 1, max));

  const itemData = sourceItem.toObject();
  delete itemData._id;
  if (itemData.system?.quantity != null) itemData.system.quantity = qty;
  itemData.flags = itemData.flags ?? {};
  itemData.flags[MODULE_ID] = {
    [FLAG.SENDER]: sender.id,
    [FLAG.RECIPIENT]: recipientActor.id,
    [FLAG.STATUS]: STATUS.PENDING,
    [FLAG.SENT_AT]: Date.now()
  };

  const existingStack = findPendingSendStack(stash, sender.id, recipientActor.id, itemData);
  if (existingStack) {
    await existingStack.update({
      "system.quantity": (existingStack.system.quantity ?? 0) + qty,
      [`flags.${MODULE_ID}.${FLAG.SENT_AT}`]: Date.now()
    });
  } else {
    await stash.createEmbeddedDocuments("Item", [itemData]);
  }
  await removeFromSource(sourceItem, qty);
}

export async function acceptItem(partyItem) {
  if (!isSendItem(partyItem)) return;
  if (isCoinPackage(partyItem)) return acceptCoinPackage(partyItem);
  const recipientId = getItemFlag(partyItem, FLAG.RECIPIENT);
  const recipient = game.actors.get(recipientId);
  if (!recipient) return;

  const data = partyItem.toObject();
  const qty = data.system?.quantity ?? 1;
  await addToActor(recipient, data, qty);
  await partyItem.delete();
}

export async function cancelItem(partyItem) {
  if (!isSendItem(partyItem)) return;
  if (isCoinPackage(partyItem)) return cancelCoinPackage(partyItem);
  const senderId = getItemFlag(partyItem, FLAG.SENDER);
  const sender = game.actors.get(senderId);
  if (!sender) return;

  const data = partyItem.toObject();
  const qty = data.system?.quantity ?? 1;
  await addToActor(sender, data, qty);
  await partyItem.delete();
}

export async function rejectItem(partyItem) {
  if (!isSendItem(partyItem)) return;
  const senderId = getItemFlag(partyItem, FLAG.SENDER);
  const recipientId = getItemFlag(partyItem, FLAG.RECIPIENT);
  await partyItem.update({
    [`flags.${MODULE_ID}.${FLAG.SENDER}`]: recipientId,
    [`flags.${MODULE_ID}.${FLAG.RECIPIENT}`]: senderId,
    [`flags.${MODULE_ID}.${FLAG.STATUS}`]: STATUS.RETURNED,
    [`flags.${MODULE_ID}.${FLAG.SENT_AT}`]: Date.now()
  });
}
