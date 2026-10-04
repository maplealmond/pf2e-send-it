import { MODULE_ID, FLAG } from "./constants.js";

export function getStashActor() {
  return game.actors?.party ?? null;
}

export function getPartyMembers() {
  const party = getStashActor();
  if (!party) return [];
  const members = party.members ?? [];
  return members.filter(a => a?.type === "character");
}

function ownershipNeedsRepair(actor) {
  const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  const ownership = actor.ownership ?? {};
  for (const user of game.users) {
    if (user.isGM) continue;
    const level = ownership[user.id] ?? ownership.default ?? 0;
    if (level < OWNER) return true;
  }
  return false;
}

async function grantPartyOwnership(party) {
  const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  const update = { "ownership.default": OWNER };
  for (const user of game.users) {
    if (user.isGM) continue;
    if (party.ownership?.[user.id] != null) {
      update[`ownership.-=${user.id}`] = null;
    }
  }
  await party.update(update);
}

export async function promptOwnershipRepair() {
  if (!game.user.isGM) return;
  const party = getStashActor();
  if (!party) return;
  if (!ownershipNeedsRepair(party)) return;

  const { DialogV2 } = foundry.applications.api;
  await DialogV2.prompt({
    window: { title: game.i18n.localize("PF2E_SEND_IT.OwnershipWarningTitle") },
    content: `<p>${game.i18n.localize("PF2E_SEND_IT.OwnershipWarningBody")}</p>`,
    ok: {
      label: game.i18n.localize("PF2E_SEND_IT.OwnershipFixButton"),
      callback: () => grantPartyOwnership(party)
    },
    rejectClose: false
  });
}

export function getItemFlag(item, key) {
  return item.getFlag(MODULE_ID, key);
}

export function isSendItem(item) {
  return Boolean(getItemFlag(item, FLAG.SENDER) && getItemFlag(item, FLAG.RECIPIENT));
}

export function userOwnsActor(actor, user = game.user) {
  if (!actor || !user) return false;
  return actor.testUserPermission(user, "OWNER");
}

export function userIsSender(item, user = game.user) {
  const senderId = getItemFlag(item, FLAG.SENDER);
  if (!senderId) return false;
  const actor = game.actors.get(senderId);
  return userOwnsActor(actor, user);
}

export function userIsRecipient(item, user = game.user) {
  const recipientId = getItemFlag(item, FLAG.RECIPIENT);
  if (!recipientId) return false;
  const actor = game.actors.get(recipientId);
  return userOwnsActor(actor, user);
}

export function getPendingItemsForUser(user = game.user) {
  const stash = getStashActor();
  if (!stash) return [];
  return stash.items.filter(item => isSendItem(item) && userIsRecipient(item, user));
}
