import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { formatYmd } from "@/lib/dates";
import type { ProfileHabit, UserProfile } from "@/lib/server/profile";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { StatTile } from "@/components/stat-tile";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Someone else's profile. Server-rendered from getUserProfile, which has
 * already applied the peer gate and the private-habit filter — nothing here
 * decides what may be shown, it only lays out what survived.
 */
export function UserProfileView({ profile }: { profile: UserProfile }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <Avatar src={profile.photoURL} name={profile.displayName} size="lg" />
        <div className="min-w-0">
          <h1 className="type-display truncate text-2xl">
            {profile.displayName}
            {profile.isSelf && (
              <span className="ml-2 text-base text-muted-foreground">(you)</span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">
            {profile.username && <span>@{profile.username} · </span>}
            {/* Formatted in UTC, not the server's locale: this renders on the
                server, so `toLocaleDateString(undefined, …)` would pick up
                whatever timezone the host happens to run in — enough to show
                the previous month for anyone who signed up just after midnight
                UTC on the 1st. */}
            {profile.joinedAtMs
              ? `Joined ${formatInTimeZone(new Date(profile.joinedAtMs), "UTC", "MMMM yyyy")}`
              : "Member"}
          </p>
        </div>
      </div>

      {profile.streaks ? (
        <div className="grid grid-cols-2 gap-3.5">
          <StatTile
            value={profile.streaks.currentStreak}
            label={
              profile.streaks.currentStreakWeeks > 0
                ? `Day streak · ${profile.streaks.currentStreakWeeks}w unbroken`
                : "Day streak"
            }
          />
          <StatTile value={profile.streaks.longestStreak} label="Best ever" />
        </div>
      ) : (
        <Card>
          <CardHeader className="pb-4">
            <CardDescription>
              {profile.displayName.split(/\s+/)[0]} has hidden their streaks from
              other people&apos;s leaderboards, so they&apos;re not shown here
              either.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-3.5">
        <StatTile value={profile.totals.checkIns} label="Check-ins" />
        {/* Short labels: three tiles across a phone leaves no room to wrap. */}
        <StatTile value={profile.totals.habitsFinished} label="Finished" />
        <StatTile value={profile.totals.habitsWon} label="Won" />
      </div>

      <HabitSection
        title="Current habits"
        empty="Nothing running right now."
        habits={profile.active}
      />
      <HabitSection
        title="Finished"
        empty="No finished habits yet."
        habits={profile.past}
      />

      {/* Said once, plainly, rather than leaving someone to wonder whether a
          number here is the whole picture. */}
      <p className="text-center text-xs text-muted-foreground">
        You only see habits that are public, or private ones you&apos;re in too —
        including in the figures above.
      </p>
    </div>
  );
}

function HabitSection({
  title,
  empty,
  habits,
}: {
  title: string;
  empty: string;
  habits: ProfileHabit[];
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5">
        {habits.length === 0 && (
          <p className="text-sm text-muted-foreground">{empty}</p>
        )}
        {habits.map((habit) => (
          <HabitRow key={habit.id} habit={habit} />
        ))}
      </CardContent>
    </Card>
  );
}

function HabitRow({ habit }: { habit: ProfileHabit }) {
  const percent =
    habit.total > 0 ? Math.round(Math.min(100, (habit.completed / habit.total) * 100)) : 0;

  // Only a shared habit is one the viewer can actually open — a public habit
  // they're not in would 404 against firestore.rules, so it isn't a link.
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-bold">{habit.name}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {habit.isPrivate && <Badge variant="outline">Private</Badge>}
          {habit.outcome === "succeeded" && <Badge variant="volt">Won</Badge>}
          {habit.outcome === "failed" && <Badge variant="secondary">Lost</Badge>}
          {habit.state === "active" && <Badge variant="secondary">Active</Badge>}
          {habit.state === "upcoming" && <Badge variant="outline">Upcoming</Badge>}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {habit.frequencyLabel} · {formatYmd(habit.startDate)} –{" "}
        {formatYmd(habit.endDate)} · {habit.completed}/{habit.total} check-ins
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-foreground"
          style={{ width: `${percent}%` }}
        />
      </div>
    </>
  );

  if (!habit.shared) {
    return <div className="rounded-xl border px-3 py-2.5">{body}</div>;
  }
  return (
    <Link
      href={`/challenges/${habit.id}`}
      className="rounded-xl border px-3 py-2.5 transition-colors hover:bg-accent"
    >
      {body}
    </Link>
  );
}
