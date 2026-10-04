import { MODULE_ID, FLAG, STATUS, COIN_DENOMS } from "./constants.js";
import { getStashActor, getItemFlag } from "./party.js";
import { findPendingSendStack } from "./send.js";

const COIN_META = {
  pp: {
    name: "Platinum Pieces",
    img: "systems/pf2e/icons/equipment/treasure/currency/platinum-pieces.webp"
  },
  gp: {
    name: "Gold Pieces",
    img: "systems/pf2e/icons/equipment/treasure/currency/gold-pieces.webp"
  },
  sp: {
    name: "Silver Pieces",
    img: "systems/pf2e/icons/equipment/treasure/currency/silver-pieces.webp"
  },
  cp: {
    name: "Copper Pieces",
    img: "systems/pf2e/icons/equipment/treasure/currency/copper-pieces.webp"
  }
};

export function getCoinDenom(item) {
  const pkg = item?.getFlag?.(MODULE_ID, FLAG.COIN_PACKAGE);
  return pkg?.denom ?? null;
}

export function isCoinPackage(item) {
  return !!getCoinDenom(item);
}

export function hasInTransitCoins(stash) {
  if (!stash) return false;
  return stash.items.some(i => isCoinPackage(i));
}

export function getActorCoins(actor) {
  const c = actor?.inventory?.coins ?? {};
  return {
    pp: c.pp ?? 0,
    gp: c.gp ?? 0,
    sp: c.sp ?? 0,
    cp: c.cp ?? 0
  };
}

function parseAmounts(input) {
  const coins = {};
  let total = 0;
  for (const d of COIN_DENOMS) {
    const raw = input?.[d];
    if (raw == null || raw === "") continue;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) continue;
    coins[d] = n;
    total += n;
  }
  return { coins, total };
}

function buildCoinData(denom, amt, senderId, recipientId) {
  const meta = COIN_META[denom];
  return {
    name: meta.name,
    type: "equipment",
    img: meta.img,
    system: { quantity: amt, description: { value: "" } },
    flags: {
      [MODULE_ID]: {
        [FLAG.SENDER]: senderId,
        [FLAG.RECIPIENT]: recipientId,
        [FLAG.STATUS]: STATUS.PENDING,
        [FLAG.SENT_AT]: Date.now(),
        [FLAG.COIN_PACKAGE]: { denom }
      }
    }
  };
}

export async function sendCoinPackage({ senderActor, recipientActor, amounts }) {
  const stash = getStashActor();
  if (!stash) {
    ui.notifications.error(game.i18n.localize("PF2E_SEND_IT.NoStash"));
    return;
  }

  const { coins, total } = parseAmounts(amounts);
  if (total === 0) {
    ui.notifications.warn(game.i18n.localize("PF2E_SEND_IT.CoinAtLeastOne"));
    return;
  }

  const have = getActorCoins(senderActor);
  for (const d of COIN_DENOMS) {
    if ((coins[d] ?? 0) > (have[d] ?? 0)) {
      ui.notifications.error(game.i18n.format("PF2E_SEND_IT.CoinNotEnough", {
        denom: d, have: have[d] ?? 0
      }));
      return;
    }
  }

  const removed = await senderActor.inventory.removeCoins(coins);
  if (removed === false) {
    ui.notifications.error(game.i18n.localize("PF2E_SEND_IT.CoinRemoveFailed"));
    return;
  }

  for (const [denom, amt] of Object.entries(coins)) {
    const data = buildCoinData(denom, amt, senderActor.id, recipientActor.id);
    const existing = findPendingSendStack(stash, senderActor.id, recipientActor.id, data);
    if (existing) {
      await existing.update({
        "system.quantity": (existing.system.quantity ?? 0) + amt,
        [`flags.${MODULE_ID}.${FLAG.SENT_AT}`]: Date.now()
      });
    } else {
      await stash.createEmbeddedDocuments("Item", [data]);
    }
  }
}

export async function acceptCoinPackage(partyItem) {
  const denom = getCoinDenom(partyItem);
  const qty = partyItem.system?.quantity ?? 0;
  const recipient = game.actors.get(getItemFlag(partyItem, FLAG.RECIPIENT));
  if (recipient && denom && qty > 0) {
    await recipient.inventory.addCoins({ [denom]: qty });
  }
  await partyItem.delete();
}

export async function cancelCoinPackage(partyItem) {
  const denom = getCoinDenom(partyItem);
  const qty = partyItem.system?.quantity ?? 0;
  const sender = game.actors.get(getItemFlag(partyItem, FLAG.SENDER));
  if (sender && denom && qty > 0) {
    await sender.inventory.addCoins({ [denom]: qty });
  }
  await partyItem.delete();
}
