import { MODULE_ID, FLAG, STATUS, COIN_DENOMS } from "./constants.js";
import { getPartyMembers, getStashActor, getPendingItemsForUser } from "./party.js";
import { sendItem, acceptItem, rejectItem } from "./send.js";
import { sendCoinPackage, getActorCoins } from "./coins.js";

const { DialogV2 } = foundry.applications.api;

export async function showSendDialog(sourceItem) {
  const sender = sourceItem.actor;
  const candidates = getPartyMembers().filter(a => a.id !== sender?.id);
  if (!candidates.length) {
    ui.notifications.warn(game.i18n.localize("PF2E_SEND_IT.NoRecipients"));
    return;
  }

  const max = sourceItem.system?.quantity ?? 1;
  const options = candidates.map(a =>
    `<option value="${a.id}">${foundry.utils.escapeHTML(a.name)}</option>`
  ).join("");

  const quantityControl = max > 1 ? `
    <div class="form-group">
      <label>${game.i18n.localize("PF2E_SEND_IT.QuantityLabel")}</label>
      <div class="form-fields pf2e-send-it-slider-row">
        <input type="range" name="quantity-range" min="1" max="${max}" value="${max}" step="1" />
        <input type="number" name="quantity" min="1" max="${max}" value="${max}" step="1" />
      </div>
    </div>
  ` : `<input type="hidden" name="quantity" value="1" />`;

  const content = `
    <form class="pf2e-send-it-dialog">
      <div class="form-group">
        <label>${game.i18n.localize("PF2E_SEND_IT.PickRecipientPrompt")}</label>
        <select name="recipient">${options}</select>
      </div>
      ${quantityControl}
    </form>
  `;

  await DialogV2.prompt({
    window: {
      title: game.i18n.format("PF2E_SEND_IT.PickRecipientTitle", { item: sourceItem.name })
    },
    content,
    render: (_event, dialog) => {
      const root = dialog.element;
      const range = root.querySelector('input[name="quantity-range"]');
      const number = root.querySelector('input[name="quantity"]');
      if (!range || !number) return;
      const clamp = (v) => Math.max(1, Math.min(max, parseInt(v, 10) || 1));
      range.addEventListener("input", () => { number.value = range.value; });
      number.addEventListener("change", () => {
        const v = clamp(number.value);
        number.value = v;
        range.value = v;
      });
    },
    ok: {
      label: game.i18n.localize("PF2E_SEND_IT.SendButton"),
      callback: async (_event, button) => {
        const form = button.form;
        const recipientId = form.elements.recipient.value;
        const quantity = parseInt(form.elements.quantity.value, 10);
        if (!recipientId || isNaN(quantity) || quantity < 1 || quantity > max) {
          ui.notifications.error(game.i18n.format("PF2E_SEND_IT.InvalidQuantity", { max }));
          return;
        }
        const recipient = game.actors.get(recipientId);
        if (!recipient) return;
        await sendItem({ sourceItem, recipientActor: recipient, quantity });
      }
    },
    rejectClose: false
  });
}

export async function showCoinSendDialog(senderActor) {
  const candidates = getPartyMembers().filter(a => a.id !== senderActor?.id);
  if (!candidates.length) {
    ui.notifications.warn(game.i18n.localize("PF2E_SEND_IT.NoRecipients"));
    return;
  }

  const have = getActorCoins(senderActor);
  const options = candidates.map(a =>
    `<option value="${a.id}">${foundry.utils.escapeHTML(a.name)}</option>`
  ).join("");

  const coinRows = COIN_DENOMS.map(d => `
    <div class="form-group pf2e-send-it-coin-row">
      <label>${d.toUpperCase()}
        <span class="pf2e-send-it-coin-have">${game.i18n.format("PF2E_SEND_IT.CoinHaveLabel", { n: have[d] ?? 0 })}</span>
      </label>
      <input type="number" name="coin-${d}" min="0" max="${have[d] ?? 0}" step="1" />
    </div>
  `).join("");

  const content = `
    <form class="pf2e-send-it-dialog">
      <div class="form-group">
        <label>${game.i18n.localize("PF2E_SEND_IT.PickRecipientPrompt")}</label>
        <select name="recipient">${options}</select>
      </div>
      ${coinRows}
    </form>
  `;

  await DialogV2.prompt({
    window: { title: game.i18n.localize("PF2E_SEND_IT.SendCoinsTitle") },
    content,
    ok: {
      label: game.i18n.localize("PF2E_SEND_IT.SendButton"),
      callback: async (_event, button) => {
        const form = button.form;
        const recipient = game.actors.get(form.elements.recipient.value);
        if (!recipient) return;
        const amounts = {};
        for (const d of COIN_DENOMS) {
          amounts[d] = form.elements[`coin-${d}`]?.value ?? "";
        }
        await sendCoinPackage({ senderActor, recipientActor: recipient, amounts });
      }
    },
    rejectClose: false
  });
}

let activePendingDialog = null;

function buildRowsHTML(items) {
  return items.map(item => {
    const qty = item.system?.quantity ?? 1;
    const sender = game.actors.get(item.getFlag(MODULE_ID, FLAG.SENDER));
    const returned = item.getFlag(MODULE_ID, FLAG.STATUS) === STATUS.RETURNED;
    const metaLabel = returned
      ? game.i18n.localize("PF2E_SEND_IT.RefusedByLabel")
      : game.i18n.localize("PF2E_SEND_IT.FromLabel");
    return `
      <li data-item-id="${item.id}">
        <img class="item-img" src="${foundry.utils.escapeHTML(item.img)}" />
        <div class="item-info">
          <div class="item-name"><strong>${foundry.utils.escapeHTML(item.name)}</strong> ×${qty}</div>
          <div class="item-meta">${metaLabel} ${foundry.utils.escapeHTML(sender?.name ?? "?")}</div>
        </div>
        <div class="item-actions">
          <button type="button" data-action="accept" data-item-id="${item.id}" data-tooltip="${game.i18n.localize("PF2E_SEND_IT.AcceptTooltip")}">
            <i class="fa-solid fa-check"></i>
          </button>
          <button type="button" data-action="reject" data-item-id="${item.id}" data-tooltip="${game.i18n.localize("PF2E_SEND_IT.RejectTooltip")}">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </li>
    `;
  }).join("");
}

function closePendingDialog() {
  const d = activePendingDialog;
  activePendingDialog = null;
  if (d) {
    try { d.close(); } catch { /* noop */ }
  }
}

export async function refreshPendingDialog() {
  const items = getPendingItemsForUser();
  if (!items.length) {
    closePendingDialog();
    return null;
  }

  if (activePendingDialog?.element?.isConnected) {
    const ul = activePendingDialog.element.querySelector(".pf2e-send-it-pending-list");
    if (ul) ul.innerHTML = buildRowsHTML(items);
    return activePendingDialog;
  }

  const content = `
    <p>${game.i18n.localize("PF2E_SEND_IT.PendingPrompt")}</p>
    <ul class="pf2e-send-it-pending-list">${buildRowsHTML(items)}</ul>
  `;

  const dialog = new DialogV2({
    window: { title: game.i18n.localize("PF2E_SEND_IT.PendingTitle") },
    content,
    buttons: [
      {
        action: "acceptAll",
        label: game.i18n.localize("PF2E_SEND_IT.AcceptAll"),
        default: true,
        callback: async () => {
          const stash = getStashActor();
          for (const item of getPendingItemsForUser()) {
            const fresh = stash?.items.get(item.id);
            if (fresh) await acceptItem(fresh);
          }
        }
      },
      {
        action: "dismiss",
        label: game.i18n.localize("PF2E_SEND_IT.Dismiss")
      }
    ],
    rejectClose: false
  });

  activePendingDialog = dialog;
  await dialog.render({ force: true });

  const root = dialog.element;
  root.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    if (action !== "accept" && action !== "reject") return;
    ev.preventDefault();
    ev.stopPropagation();
    const itemId = btn.dataset.itemId;
    const stash = getStashActor();
    const item = stash?.items.get(itemId);
    if (!item) return;
    if (action === "accept") await acceptItem(item);
    else if (action === "reject") await rejectItem(item);
  });

  return dialog;
}
