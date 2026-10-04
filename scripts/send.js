import { MODULE_ID, FLAG, STATUS } from "./constants.js";
import { getStashActor, getItemFlag, isSendItem } from "./party.js";

async function removeFromSource(sourceItem, qty) {
  const current = sourceItem.system?.quantity ?? 1;
  if (qty >= current) {
    await sourceItem.delete();
  } else {
    await sourceItem.update({ "system.quantity": current - qty });
  }
}

async function addToActor(actor, itemData, qty) {
  const existing = actor.items.find(i =>
    i.sourceId === itemData.flags?.core?.sourceId &&
    i.name === itemData.name &&
    !isSendItem(i)
  );
  if (existing && existing.system?.quantity != null) {
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

  await stash.createEmbeddedDocuments("Item", [itemData]);
  await removeFromSource(sourceItem, qty);

  ui.notifications.info(game.i18n.format("PF2E_SEND_IT.SentToast", {
    item: sourceItem.name,
    qty,
    recipient: recipientActor.name
  }));
}

export async function acceptItem(partyItem) {
  if (!isSendItem(partyItem)) return;
  const recipientId = getItemFlag(partyItem, FLAG.RECIPIENT);
  const recipient = game.actors.get(recipientId);
  if (!recipient) return;

  const data = partyItem.toObject();
  const qty = data.system?.quantity ?? 1;
  await addToActor(recipient, data, qty);
  await partyItem.delete();

  ui.notifications.info(game.i18n.format("PF2E_SEND_IT.AcceptedToast", {
    item: partyItem.name,
    qty
  }));
}

export async function cancelItem(partyItem) {
  if (!isSendItem(partyItem)) return;
  const senderId = getItemFlag(partyItem, FLAG.SENDER);
  const sender = game.actors.get(senderId);
  if (!sender) return;

  const data = partyItem.toObject();
  const qty = data.system?.quantity ?? 1;
  await addToActor(sender, data, qty);
  await partyItem.delete();

  ui.notifications.info(game.i18n.format("PF2E_SEND_IT.CancelledToast", {
    item: partyItem.name
  }));
}

export async function rejectItem(partyItem) {
  if (!isSendItem(partyItem)) return;
  const senderId = getItemFlag(partyItem, FLAG.SENDER);
  const recipientId = getItemFlag(partyItem, FLAG.RECIPIENT);
  const sender = game.actors.get(senderId);
  await partyItem.update({
    [`flags.${MODULE_ID}.${FLAG.SENDER}`]: recipientId,
    [`flags.${MODULE_ID}.${FLAG.RECIPIENT}`]: senderId,
    [`flags.${MODULE_ID}.${FLAG.STATUS}`]: STATUS.RETURNED,
    [`flags.${MODULE_ID}.${FLAG.SENT_AT}`]: Date.now()
  });

  ui.notifications.info(game.i18n.format("PF2E_SEND_IT.RejectedToast", {
    item: partyItem.name,
    sender: sender?.name ?? "sender"
  }));
}
