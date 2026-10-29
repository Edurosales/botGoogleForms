import { NextResponse } from "next/server";
import { getWebUser } from "@/lib/googleAuth";
import { creditsBoughtToday, limitsFor, responsesUsedToday } from "@/lib/limits";

/** Contadores del día de la cuenta: respuestas enviadas y créditos comprados en 24 h. */
export async function GET() {
  const user = await getWebUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const [lim, used, bought] = await Promise.all([limitsFor(user.email), responsesUsedToday(user.id), creditsBoughtToday(user.id)]);
  return NextResponse.json(
    {
      ok: true,
      responses: { used, max: lim.maxDailyResponses, left: Math.max(0, lim.maxDailyResponses - used) },
      purchases: { bought, max: lim.dailyPurchaseCap, left: Math.max(0, lim.dailyPurchaseCap - bought) },
      maxPaidQuestions: lim.maxPaidQuestions,
      maxFreeQuestions: lim.maxFreeQuestions,
      privileged: lim.privileged,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
