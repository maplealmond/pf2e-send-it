import { MODULE_ID, FLAG, STATUS } from "./constants.js";
import { getStashActor, getItemFlag, isSendItem } from "./party.js";
import { isCoinPackage, acceptCoinPackage, cancelCoinPackage } from "./coins.js";

function isContainer(item) {
  if (!item) return false;
  if (item.contents) return true;
  return item.type === "backpack";
}

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
  if (isContainer(itemData)) return null;
  return actor.items.find(i =>
    !isSendItem(i) &&
    i.system?.quantity != null &&
    sameItemIdentity(i, itemData)
  );
}

export function findPendingSendStack(stash, senderId, recipientId, incoming) {
  if (isContainer(incoming)) return null;
  return stash.items.find(i =>
    isSendItem(i) &&
    i.getFlag(MODULE_ID, FLAG.SENDER) === senderId &&
    i.getFlag(MODULE_ID, FLAG.RECIPIENT) === recipientId &&
    i.getFlag(MODULE_ID, FLAG.STATUS) === STATUS.PENDING &&
    i.system?.quantity != null &&
    sameItemIdentity(i, incoming)
  );
}

function collectContainerTree(container, actor) {
  const descendants = [];
  const walk = (parent) => {
    const children = actor.items.filter(i => i.system?.containerId === parent.id);
    for (const child of children) {
      descendants.push(child);
      if (isContainer(child)) walk(child);
    }
  };
  walk(container);
  return descendants;
}

function makeSendFlags(senderId, recipientId, packageId) {
  return {
    [FLAG.SENDER]: senderId,
    [FLAG.RECIPIENT]: recipientId,
    [FLAG.STATUS]: STATUS.PENDING,
    [FLAG.SENT_AT]: Date.now(),
    ...(packageId ? { [FLAG.PACKAGE_ID]: packageId } : {})
  };
}

function buildRemappedTree(items, { senderId, recipientId, packageId, stripSendFlags = false }) {
  const idMap = {};
  for (const item of items) idMap[item.id] = foundry.utils.randomID();

  return items.map(item => {
    const data = item.toObject();
    data._id = idMap[item.id];
    data.system = data.system ?? {};
    const oldContainerId = data.system.containerId;
    data.system.containerId = oldContainerId && idMap[oldContainerId] ? idMap[oldContainerId] : null;
    data.flags = data.flags ?? {};
    if (stripSendFlags) {
      delete data.flags[MODULE_ID];
    } else {
      data.flags[MODULE_ID] = makeSendFlags(senderId, recipientId, packageId);
    }
    return data;
  });
}

async function sendContainerPackage({ sourceContainer, recipientActor, stash }) {
  const sender = sourceContainer.actor;
  const descendants = collectContainerTree(sourceContainer, sender);
  const tree = [sourceContainer, ...descendants];
  const packageId = foundry.utils.randomID();
  const dataArr = buildRemappedTree(tree, {
    senderId: sender.id,
    recipientId: recipientActor.id,
    packageId
  });
  // Top-level container has no parent on the stash
  dataArr[0].system.containerId = null;

  await stash.createEmbeddedDocuments("Item", dataArr, { keepId: true });
  await sender.deleteEmbeddedDocuments("Item", tree.map(i => i.id));
}

export async function sendItem({ sourceItem, recipientActor, quantity }) {
  const stash = getStashActor();
  if (!stash) {
    ui.notifications.error(game.i18n.localize("PF2E_SEND_IT.NoStash"));
    return;
  }
  const sender = sourceItem.actor;
  if (!sender) return;

  if (isContainer(sourceItem)) {
    await sendContainerPackage({ sourceContainer: sourceItem, recipientActor, stash });
    return;
  }

  const max = sourceItem.system?.quantity ?? 1;
  const qty = Math.max(1, Math.min(quantity ?? 1, max));

  const itemData = sourceItem.toObject();
  delete itemData._id;
  if (itemData.system?.quantity != null) itemData.system.quantity = qty;
  itemData.flags = itemData.flags ?? {};
  itemData.flags[MODULE_ID] = makeSendFlags(sender.id, recipientActor.id);

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

function getPackageSiblings(partyItem) {
  const packageId = getItemFlag(partyItem, FLAG.PACKAGE_ID);
  if (!packageId) return [partyItem];
  const stash = getStashActor();
  if (!stash) return [partyItem];
  return stash.items.filter(i => i.getFlag(MODULE_ID, FLAG.PACKAGE_ID) === packageId);
}

async function transferPackageTree(partyItem, destinationActor) {
  const siblings = getPackageSiblings(partyItem);
  // Ensure the triggered item (the root container) is first in the array
  const ordered = [partyItem, ...siblings.filter(i => i.id !== partyItem.id)];
  const dataArr = buildRemappedTree(ordered, { stripSendFlags: true });
  dataArr[0].system.containerId = null;
  await destinationActor.createEmbeddedDocuments("Item", dataArr, { keepId: true });
  const stash = getStashActor();
  await stash.deleteEmbeddedDocuments("Item", ordered.map(i => i.id));
}

export async function acceptItem(partyItem) {
  if (!isSendItem(partyItem)) return;
  if (isCoinPackage(partyItem)) return acceptCoinPackage(partyItem);

  const recipient = game.actors.get(getItemFlag(partyItem, FLAG.RECIPIENT));
  if (!recipient) return;

  if (getItemFlag(partyItem, FLAG.PACKAGE_ID)) {
    await transferPackageTree(partyItem, recipient);
    return;
  }

  const data = partyItem.toObject();
  const qty = data.system?.quantity ?? 1;
  await addToActor(recipient, data, qty);
  await partyItem.delete();
}

export async function cancelItem(partyItem) {
  if (!isSendItem(partyItem)) return;
  if (isCoinPackage(partyItem)) return cancelCoinPackage(partyItem);

  const sender = game.actors.get(getItemFlag(partyItem, FLAG.SENDER));
  if (!sender) return;

  if (getItemFlag(partyItem, FLAG.PACKAGE_ID)) {
    await transferPackageTree(partyItem, sender);
    return;
  }

  const data = partyItem.toObject();
  const qty = data.system?.quantity ?? 1;
  await addToActor(sender, data, qty);
  await partyItem.delete();
}

export async function rejectItem(partyItem) {
  if (!isSendItem(partyItem)) return;
  const senderId = getItemFlag(partyItem, FLAG.SENDER);
  const recipientId = getItemFlag(partyItem, FLAG.RECIPIENT);
  const stash = getStashActor();
  const siblings = getPackageSiblings(partyItem);

  if (siblings.length > 1 && stash) {
    const updates = siblings.map(i => ({
      _id: i.id,
      [`flags.${MODULE_ID}.${FLAG.SENDER}`]: recipientId,
      [`flags.${MODULE_ID}.${FLAG.RECIPIENT}`]: senderId,
      [`flags.${MODULE_ID}.${FLAG.STATUS}`]: STATUS.RETURNED,
      [`flags.${MODULE_ID}.${FLAG.SENT_AT}`]: Date.now()
    }));
    await stash.updateEmbeddedDocuments("Item", updates);
    return;
  }

  await partyItem.update({
    [`flags.${MODULE_ID}.${FLAG.SENDER}`]: recipientId,
    [`flags.${MODULE_ID}.${FLAG.RECIPIENT}`]: senderId,
    [`flags.${MODULE_ID}.${FLAG.STATUS}`]: STATUS.RETURNED,
    [`flags.${MODULE_ID}.${FLAG.SENT_AT}`]: Date.now()
  });
}
