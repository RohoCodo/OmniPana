import { NextResponse } from "next/server";
import type { WorkspaceData } from "@/components/types";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { withLocationScope } from "@/lib/inventory";
import { inventoryService } from "@/lib/inventory/service";
import { serialize } from "@/lib/inventory/shared";

function demoMode(): boolean {
  return process.env.DEMO_MODE === "true" || !process.env.OPENAI_API_KEY?.trim();
}

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

    const locations = await db.location.findMany({
      where: { organizationId: user.organizationId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, name: true, address: true, varianceThreshold: true },
    });
    const location = locations[0] ?? null;
    if (!location) return NextResponse.json({ error: "No location found for this workspace." }, { status: 400 });

    const products = await withLocationScope(user.id, () => inventoryService.getInventory(location.id));

    const [menuItems, transactions, photos, invoices, physicalCounts, sales, imports] = await Promise.all([
      db.menuItem.findMany({
        where: { locationId: location.id },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        include: { recipe: { include: { ingredients: true } } },
      }),
      db.inventoryTransaction.findMany({
        where: { locationId: location.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 500,
        include: { product: { select: { name: true } } },
      }),
      db.photo.findMany({
        where: { locationId: location.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 200,
      }),
      db.invoice.findMany({
        where: { locationId: location.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 200,
      }),
      db.physicalCount.findMany({
        where: { locationId: location.id },
        orderBy: [{ countedAt: "desc" }, { id: "desc" }],
        take: 500,
      }),
      db.sale.findMany({
        where: { locationId: location.id },
        orderBy: [{ soldAt: "desc" }, { id: "desc" }],
        take: 500,
        include: { menuItem: { select: { name: true } } },
      }),
      db.toastImport.findMany({
        where: { locationId: location.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 200,
      }),
    ]);

    const data: WorkspaceData = {
      user: { name: user.name, email: user.email },
      organization: { name: user.organization.name },
      locations: serialize(locations),
      location: serialize(location),
      products: products.map(product => ({
        ...product,
        dollarVariance: product.varianceValue,
        countedAt: product.lastCount,
      })),
      menuItems: serialize(menuItems) as WorkspaceData["menuItems"],
      transactions: serialize(transactions) as WorkspaceData["transactions"],
      photos: serialize(photos) as WorkspaceData["photos"],
      invoices: serialize(invoices) as WorkspaceData["invoices"],
      physicalCounts: serialize(physicalCounts) as WorkspaceData["physicalCounts"],
      sales: serialize(sales) as WorkspaceData["sales"],
      imports: serialize(imports) as WorkspaceData["imports"],
      demo: demoMode(),
    };

    return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workspace load failed";
    const status = message.toLowerCase().includes("authentication") ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
