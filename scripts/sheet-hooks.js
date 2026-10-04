import { MODULE_ID, FLAG, STATUS } from "./constants.js";
import {
  getStashActor,
  getItemFlag,
  isSendItem,
  userIsSender,
  userIsRecipient,
  userOwnsActor
} from "./party.js";
import { showSendDialog } from "./dialogs.js";
import { acceptItem, cancelItem } from "./send.js";

function toElement(html) {
  return html instanceof HTMLElement ? html : html?.[0];
}

export function registerCharacterSheetHook() {
  Hooks.on("renderCharacterSheetPF2e", (app, html) => {
    const root = toElement(html);
    const actor = app.actor;
    if (!root || !actor) return;
    if (!userOwnsActor(actor)) return;
    if (!getStashActor()) return;

    const rows = root.querySelectorAll(".inventory-list [data-item-id]");
    for (const row of rows) {
      if (row.querySelector(".pf2e-send-it-button")) continue;
      const itemId = row.dataset.itemId;
      const item = actor.items.get(itemId);
      if (!item) continue;
      if (!item.isOfType?.("physical") && item.system?.quantity == null) continue;

      const controls = row.querySelector(".item-controls") ?? row.querySelector(".item-controls-container");
      if (!controls) continue;

      const btn = document.createElement("a");
      btn.className = "pf2e-send-it-button";
      btn.dataset.action = "pf2e-send-it-send";
      btn.dataset.itemId = itemId;
      btn.title = game.i18n.localize("PF2E_SEND_IT.SendToTooltip");
      btn.setAttribute("data-tooltip", btn.title);
      btn.innerHTML = `<i class="fa-solid fa-paper-plane"></i>`;
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        await showSendDialog(item);
      });
      controls.prepend(btn);
    }
  });
}

export function registerStashSheetHook() {
  const handler = (app, html) => {
    const root = toElement(html);
    const stash = app.actor;
    if (!root || !stash || stash !== getStashActor()) return;

    const isGM = game.user.isGM;
    const rows = root.querySelectorAll("[data-item-id]");

    for (const row of rows) {
      const itemId = row.dataset.itemId;
      const item = stash.items.get(itemId);
      if (!item || !isSendItem(item)) continue;

      const sender = !isGM && userIsSender(item);
      const recipient = !isGM && userIsRecipient(item);

      if (!isGM && !sender && !recipient) {
        row.classList.add("pf2e-send-it-hidden");
        continue;
      }

      if (row.querySelector(".pf2e-send-it-badge")) continue;

      const nameCell = row.querySelector(".item-name, .name, [data-tooltip-text], h4") ?? row;
      const status = getItemFlag(item, FLAG.STATUS);
      const recipientActor = game.actors.get(getItemFlag(item, FLAG.RECIPIENT));
      const badge = document.createElement("span");
      badge.className = "pf2e-send-it-badge";
      if (isGM) {
        badge.classList.add(status === STATUS.RETURNED ? "returned" : "for-you");
        badge.textContent = game.i18n.format("PF2E_SEND_IT.ForCharacterBadge", {
          name: recipientActor?.name ?? "?"
        });
      } else if (status === STATUS.RETURNED) {
        badge.classList.add("returned");
        badge.textContent = game.i18n.localize("PF2E_SEND_IT.ReturnedBadge");
      } else if (recipient) {
        badge.classList.add("for-you");
        badge.textContent = game.i18n.localize("PF2E_SEND_IT.ForYouBadge");
      } else if (sender) {
        badge.classList.add("from-you");
        badge.textContent = game.i18n.localize("PF2E_SEND_IT.FromYouBadge");
      }
      nameCell.appendChild(badge);

      const controls = row.querySelector(".item-controls") ?? row.querySelector(".item-controls-container") ?? nameCell;

      if (recipient) {
        const accept = document.createElement("a");
        accept.className = "pf2e-send-it-button pf2e-send-it-accept";
        accept.title = game.i18n.localize("PF2E_SEND_IT.AcceptTooltip");
        accept.setAttribute("data-tooltip", accept.title);
        accept.innerHTML = `<i class="fa-solid fa-check"></i>`;
        accept.addEventListener("click", async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          await acceptItem(item);
        });
        controls.prepend(accept);
      }

      if (sender) {
        const cancel = document.createElement("a");
        cancel.className = "pf2e-send-it-button pf2e-send-it-cancel";
        cancel.title = game.i18n.localize("PF2E_SEND_IT.CancelSendTooltip");
        cancel.setAttribute("data-tooltip", cancel.title);
        cancel.innerHTML = `<i class="fa-solid fa-xmark"></i>`;
        cancel.addEventListener("click", async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          await cancelItem(item);
        });
        controls.prepend(cancel);
      }
    }
  };

  Hooks.on("renderPartySheetPF2e", handler);
  Hooks.on("renderPartySheetPf2e", handler);
}
