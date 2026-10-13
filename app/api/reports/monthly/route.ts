import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildMonthlyReport, monthlyReportToCsv } from "@/lib/reports/monthly";

async function defaultLocationId(organizationId: string): Promise<string> {
  const location = await db.location.findFirst({
    where: { organizationId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (!location) throw new Error("No location found for this workspace.");
  return location.id;
}

export async function GET(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

    const url = new URL(request.url);
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");
    if (!start || !end) return NextResponse.json({ error: "start and end query params are required" }, { status: 400 });

    const locationId = url.searchParams.get("locationId") ?? await defaultLocationId(user.organizationId);
    const format = (url.searchParams.get("format") ?? "json").toLowerCase();

    const report = await buildMonthlyReport({ locationId, userId: user.id, start, end });

    if (format === "csv") {
      const csv = monthlyReportToCsv(report);
      const filename = `monthly-report-${report.start.slice(0, 10)}-${report.end.slice(0, 10)}.csv`;
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename=\"${filename}\"`,
          "cache-control": "no-store",
        },
      });
    }

    return NextResponse.json(report, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to generate monthly report";
    const status = message.toLowerCase().includes("authentication") ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
