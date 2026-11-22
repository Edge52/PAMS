/**
 * Who sees supplier prices (audit R9, decided 22 Nov 2026). Offers, their prices, order values and invoices are
 * confidential to the people who buy and pay (Law 182): Admin, Director (approves awards and orders), Procurement
 * and Finance. Everyone else sees tenders and orders — items, quantities, dates, status — without the money.
 */
import { can } from "./permissions";
import { formatMoney } from "../format";

export const HIDDEN_PRICE = "Hidden";

export function seesPrices(role: string | null | undefined): boolean {
  return can(role, "prices.view");
}

/** formatMoney for people who may see prices, "Hidden" for everyone else. */
export function shownMoney(prices: boolean, ...args: Parameters<typeof formatMoney>): string {
  return prices ? formatMoney(...args) : HIDDEN_PRICE;
}

/** Pages only for people who may see prices: offers, invoices, budgets, framework agreements, the executive summary. */
const PRICE_PAGES = /^\/(procurement\/(offers|invoices|budgets|frameworks)(\/|\?|$)|reports\/(executive|open-purchase-orders)(\/|\?|$))/;

/** Whether a link inside the app can be opened by this role, as far as price access goes. */
export function opensFor(role: string | null | undefined, href: string | null | undefined): boolean {
  return !href || seesPrices(role) || !PRICE_PAGES.test(href);
}
