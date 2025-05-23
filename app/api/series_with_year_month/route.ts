import { NextResponse } from "next/server";

export async function GET() {
  try {
    const res = await fetch("https://ep-rec-api.oopus.info/series_with_year_month", {
      headers: { "Accept": "application/json" },
      // No credentials, just a passthrough
    });
    if (!res.ok) {
      return NextResponse.json({ error: "Upstream API error" }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: "Proxy fetch failed" }, { status: 500 });
  }
}
