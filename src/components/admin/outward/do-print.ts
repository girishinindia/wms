"use client";

import { fmtDateTime } from "@/lib/format/datetime";
import type { DoDetail } from "@/lib/outward/ops";

import { printHtml, qrSvg } from "../carton-print";

const esc = (s: string | null | undefined) =>
  (s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const CSS = `
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 11pt; margin: 0; }
  h1 { font-size: 18pt; margin: 0; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; border-bottom: 2px solid #111; padding-bottom: 8px; }
  .no { font-family: "Courier New", monospace; font-size: 16pt; font-weight: bold; }
  .qr svg { width: 26mm; height: 26mm; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 18px; margin: 10px 0; }
  .box { border: 1px solid #999; padding: 6px 8px; }
  .lbl { font-size: 8pt; text-transform: uppercase; letter-spacing: .06em; color: #555; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border: 1px solid #999; padding: 4px 6px; text-align: left; vertical-align: top; font-size: 10pt; }
  th { background: #eee; font-size: 8.5pt; text-transform: uppercase; }
  td.n { text-align: right; font-family: "Courier New", monospace; }
  .sign { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 30px; }
  .sign div { border-top: 1px solid #111; padding-top: 4px; font-size: 9pt; text-align: center; }
  .small { font-size: 8.5pt; color: #444; }
`;

/** The Dispatch Order on A4: goes with the vehicle, and into the file. */
export async function printDispatchOrder(o: DoDetail) {
  const qr = await qrSvg([o.doNo, `DN ${o.dnNo}`, `${o.packages} packages / ${o.cartons} cartons`].join("\n"));
  const rows = o.packageList
    .map(
      (p, i) =>
        `<tr><td class="n">${i + 1}</td><td><b>${esc(p.code)}</b> <span class="small">${esc(p.kind === "SINGLE" ? "single carton" : p.kind.toLowerCase())}</span></td><td>${esc(p.items)}</td><td class="n">${p.cartons}</td><td class="small">${esc(p.cartonNos.join(", "))}</td></tr>`,
    )
    .join("");
  const body = `
    <div class="top">
      <div>
        <h1>Dispatch Order</h1>
        <div class="no">${esc(o.doNo)}</div>
        <div class="small">Delivery note ${esc(o.dnNo)} · Order ${esc(o.orderNo)} · ${esc(o.warehouseName)}</div>
        <div class="small">${o.dispatchedAt ? `Left ${esc(fmtDateTime(o.dispatchedAt))}` : `Status: ${esc(o.statusLabel)}`}</div>
      </div>
      <div class="qr">${qr}</div>
    </div>
    <div class="grid">
      <div class="box"><div class="lbl">Buyer (deliver to)</div><b>${esc(o.buyerName)}</b><br>${esc(o.buyerAddress)}<br>${esc(o.destination)}${o.buyerMobile ? `<br>Mobile ${esc(o.buyerMobile)}` : ""}</div>
      <div class="box"><div class="lbl">Importer (goods of)</div><b>${esc(o.importerName)}</b>${o.agentName ? `<br>Sales agent: ${esc(o.agentName)}` : ""}</div>
      <div class="box"><div class="lbl">Transporter</div><b>${esc(o.transportName)}</b>${o.transporterMobile ? `<br>${esc(o.transporterMobile)}` : ""}${o.transporterGstin ? `<br>GSTIN ${esc(o.transporterGstin)}` : ""}</div>
      <div class="box"><div class="lbl">Vehicle and driver</div><b>${esc(o.vehicleNo)}</b> ${esc(o.vehicleType)}<br>${esc(o.driverName)} ${esc(o.driverMobile)}<br><span class="small">Mode: ${esc(o.transportMode.toLowerCase())}</span></div>
    </div>
    <table>
      <thead><tr><th>#</th><th>Package</th><th>Items</th><th>Cartons</th><th>Carton numbers</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th colspan="3">Total: ${o.packages} package${o.packages === 1 ? "" : "s"}</th><th class="n">${o.cartons}</th><th></th></tr></tfoot>
    </table>
    ${o.remarks ? `<p class="small">Remarks: ${esc(o.remarks)}</p>` : ""}
    <div class="sign"><div>Loaded by</div><div>Driver</div><div>Dispatch manager</div></div>
  `;
  await printHtml(`${o.doNo} dispatch order`, CSS, body);
}
