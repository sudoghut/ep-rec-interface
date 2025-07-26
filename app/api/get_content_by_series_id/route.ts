import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const res = await fetch("https://ep-rec-api.oopus.info/get_content_by_series_id", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!res.ok) {
      return NextResponse.json({ error: "Upstream API error" }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (_e) {
    return NextResponse.json({ error: "Proxy fetch failed", detail: String(_e) }, { status: 500 });
  }
}
