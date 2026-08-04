import { NextResponse } from "next/server";
import { precomputeStreakStats } from "@/lib/server/leaderboard";

/**
 * Scheduled refresh of every user's leaderboard stats. See vercel.json for the
 * schedule and precomputeStreakStats for why it runs just after midnight UTC.
 *
 * A Next route rather than a Cloud Function, and that is the point: the whole
 * streak/chain/leaderboard engine already lives in this package. Putting the
 * job in functions/ would mean duplicating it there, which this codebase only
 * does for small pure helpers that a parity test can pin (see the header of
 * functions/src/badges.ts) — never for something this size.
 */

// The work is per-user Firestore round trips, not CPU, so the default ceiling
// is the binding constraint rather than anything about the algorithm. 60 and
// not more: it is the maximum every Vercel plan accepts, and a build fails
// outright on a value the plan disallows. At the current user count the run
// finishes in well under a second; raise it here if that stops being true.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return run(request);
}

// Vercel Cron issues a GET. POST is accepted too so the job can be triggered
// by hand without pretending to be the scheduler.
export async function GET(request: Request) {
  return run(request);
}

async function run(request: Request) {
  const secret = process.env.CRON_SECRET;
  // Fails closed. An unset secret means an unprotected endpoint that recomputes
  // the whole user base on demand, which is a denial-of-service button rather
  // than a missing convenience.
  if (!secret) {
    console.error("CRON_SECRET is not set; refusing to run the precompute");
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await precomputeStreakStats();
    console.info(
      `streak-stats precompute: ${result.refreshed} refreshed, ${result.upToDate} already current, ${result.failed} failed`
    );
    // 200 even with failures — the run did its job for everyone else, and a
    // non-2xx would make the scheduler report the whole thing as broken. The
    // count is in the body and the detail is in the logs.
    return NextResponse.json(result);
  } catch (err) {
    console.error("streak-stats precompute failed:", err);
    return NextResponse.json({ error: "Precompute failed" }, { status: 500 });
  }
}
