import { NextResponse } from "next/server";

import { deliveryRoute } from "@/lib/delivery/http";
import { dnScope, getNote } from "@/lib/delivery/ops";
import { deliveryNotePdf } from "@/lib/delivery/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/delivery-notes/{id}/pdf — the delivery note to print or share. ?download=1 saves it. */
export const GET = deliveryRoute("dispatch.order.read", async ({ actor, grant, id, request }) => {
  const note = await getNote(dnScope(actor, grant), actor, id!);
  const bytes = await deliveryNotePdf(note);
  const name = `Delivery-Note-${note.dnNo.replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "")}.pdf`;
  const disposition = request.nextUrl.searchParams.get("download") ? "attachment" : "inline";
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${disposition}; filename="${name}"`,
      "cache-control": "private, no-store",
    },
  });
});
