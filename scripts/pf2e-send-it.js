import { registerCharacterSheetHook, registerStashSheetHook } from "./sheet-hooks.js";
import { registerCreateItemHook, showPendingOnReady } from "./notifications.js";
import { ensurePartyOwnership } from "./party.js";

Hooks.once("init", () => {
  registerCharacterSheetHook();
  registerStashSheetHook();
  registerCreateItemHook();
});

Hooks.once("ready", async () => {
  await ensurePartyOwnership();
  showPendingOnReady();
});
