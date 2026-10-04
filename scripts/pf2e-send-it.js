import { MODULE_ID } from "./constants.js";
import { ensurePartyOwnership, getStashActor } from "./party.js";
import { registerCharacterSheetHook, registerStashSheetHook } from "./sheet-hooks.js";
import { registerCreateItemHook, showPendingOnReady } from "./notifications.js";

function registerDragWipeHook() {
  Hooks.on("preCreateItem", (item, _data, _options, userId) => {
    if (game.user.id !== userId) return;
    const parent = item.parent;
    if (!parent) return;
    if (parent === getStashActor()) return;
    const flags = item.flags?.[MODULE_ID];
    if (!flags) return;

    const coinPkg = flags.coinPackage;
    if (coinPkg?.denom && parent.inventory?.addCoins) {
      const qty = item.system?.quantity ?? 0;
      if (qty > 0) parent.inventory.addCoins({ [coinPkg.denom]: qty });
      return false;
    }

    item.updateSource({ [`flags.-=${MODULE_ID}`]: null });
  });
}

Hooks.once("init", () => {
  registerCharacterSheetHook();
  registerStashSheetHook();
  registerCreateItemHook();
  registerDragWipeHook();
});

Hooks.once("ready", async () => {
  await ensurePartyOwnership();
  showPendingOnReady();
});
