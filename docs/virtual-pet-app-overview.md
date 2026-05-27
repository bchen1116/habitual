# Virtual Pet App — Project Overview

A Tamagotchi-inspired iOS app: users care for a virtual pet — a specific **breed of cat or dog** — through a daily routine, the pet can live as an animated presence on the home screen, exercise responds to the user's real-world activity, and nearby friends can connect their phones to play games together.

---

## Decisions Made So Far

| Question | Decision |
|---|---|
| Platform | **iOS only** (simplifies everything — no cross-platform pain) |
| "Touch phones" mechanic | **Nearby play** is enough; the literal NFC bump is not required |
| Core of the app | **The pet-care daily loop** is the heart |
| Pet death | **Pets can die**, and the death is recorded in the user's lifetime stats |
| Pet types | **Cats & dogs, by breed** — breed is data-driven (traits affect gameplay) |
| Multiplayer sync | **Round-based** (exchange one score per round) — no real-time netcode |

---

## Feature Feasibility

### 1. Pet-care daily loop — ✅ Core, fully doable
The retention engine. Pet has stats (hunger, happiness, energy, etc.) that change over time and require the user to show up on the pet's schedule.

**Key technical rule:** Do **not** run a background timer to drain stats — iOS suspends the app when closed. Instead, store *timestamps* (last fed, last played) and **compute** the pet's current state from elapsed time when the app opens. This is the standard idle-game pattern. Local notifications ("your pet misses you") pull users back.

### 2. Pet death + lifetime history — ✅ Easy
Just persisted data. Log a death event (name, born/died timestamps, cause, age reached, days survived) to a lifetime history. This history doubles as a retention hook: a graveyard / hall-of-fame screen, streaks, and "longest-lived pet" records.

*Design note:* permanent death is motivating but can make people quit. Worth deciding how punishing it should feel.

### 3. Pet living in a widget — ⚠️ Possible, but limited
The pet **can** live in a widget, but **cannot freely move around** in one. Widgets are not a live canvas — they render a timeline of pre-built static snapshots on a system schedule, with no game loop and roughly a 2-second cap on animations (the well-known Widgif app manages only ~1 FPS).

**What works in the widget:**
- Limited frame-style animation (breathing, blinking, a short hop loop — GIF-ish, low frame rate)
- State changes on timeline updates (idle → sleeping → hungry), animated since iOS 17 (flakier in iOS 18, so keep it simple)
- Interactive buttons via App Intents — tap to "feed"/"pet" from the home screen, runs in the background
- Newest iOS adds visual polish (glass rendering, push updates) but no free movement

**Design pattern:** the widget is a *glanceable status window*; the pet wandering its world lives in the **app**. **Live Activities** (Lock Screen / Dynamic Island) are a middle ground if you want something livelier outside the app.

### 4. Exercise from real activity (HealthKit) — ✅ Doable, natural fit
Request read access to step count, active energy, exercise minutes, workouts, distance. Convert the user's real activity into pet mechanics (e.g., steps → pet energy; hitting a move goal → pet workout + stat gain). Apple Watch gives richer data; plain iPhone step data works alone.

**Gotchas:**
- Needs usage-description strings in Info.plist; health apps get extra App Store review scrutiny
- **Can't detect a denial** — denied read access returns *empty data*, indistinguishable from "zero activity." Design a manual fallback.
- Background delivery can wake the app on new data (pairs well with the widget + notifications)
- Test on a real device — Simulator health data is limited

*Design note:* let activity *boost* the pet (bonus/happiness/growth) rather than being the only thing keeping it alive — keeps the carrot without the guilt.

### 5. Nearby multiplayer games — ✅ Architected (build deferred)
Since it's iOS-only + nearby play, use Apple's built-in **Multipeer Connectivity** — no server, no custom Bluetooth. The "touch" feel can be faked convincingly: both users open a play screen, connect via nearby discovery or a short code, and an animation sells the "bump." Needs Local Network + Bluetooth permission prompts.

**Round-based, not real-time:** each round exchanges a single score message, so there's no lockstep netcode to get wrong — far more robust over Bluetooth and plenty fun for a casual pet game. The game layer is fully scaffolded (see Architecture below); only the actual Multipeer transport + the minigame views remain.

---

## Recommended Stack
- **Swift + SwiftUI** — cleanest path to the native frameworks (WidgetKit, HealthKit, Multipeer)
- **SwiftData** — local persistence (no backend needed for v1)
- **Local notifications** — daily-loop re-engagement
- No backend required for the initial version

---

## Suggested Build Order
1. **Pet state model + time-decay logic** — the brain; get this right first
2. **Pet UI and animations** — the thing people fall in love with
3. **Local persistence (SwiftData) + notifications** — completes the daily loop; shippable on its own
4. **Widget** — glanceable status with light animation + interactive feed/pet buttons
5. **HealthKit exercise integration** — activity feeds the pet
6. **Multipeer nearby play + one simple mini-game** — bolt on last
7. Polish, sound, App Store prep

---

## Resolved Design Decisions
- **One pet alive at a time** — a new pet can only be hatched once the current one has died (`Player.startNewPet` enforces this).
- **Old age is a valid death cause** — pets have a per-breed lifespan; reaching it = death by old age. Makes "longest-lived" a real achievement.
- **Death is permanent**, recorded to a lifetime history.
- **Real activity *boosts* the pet** (energy/happiness) — it never gates survival, so a lazy week makes the pet sad, not dead.
- **Cats & dogs by breed** — breeds are pure data; traits change how the pet plays.
- **Games route through the engine** — a game grants a reward and *costs energy*, exactly like any other interaction.
- **Round-based multiplayer** — one score exchanged per round; transport is abstracted behind a protocol.

## Still Open (later)
- How "alive" should the widget feel vs. reserving liveliness for the app / Live Activities?
- Exact tuning of decay rates, lifespans, rewards (centralized in `PetConfig` + `GameCatalog`).
- Final v1 game lineup (catalog has 8; ship a subset first).
- Art roster: how many breeds to launch with (each needs a skin).

---

## Architecture (implemented)

All systems flow through **one engine** (`Pet.refresh`), keeping a single source of truth. Everything is data-driven — adding a breed or a game is a one-line catalog entry, no logic changes.

### `PetModels.swift` — core engine & persistence
- **`Pet`** — the single living pet; stats are *snapshots* tagged with one `statsUpdatedAt`. Nothing runs in the background.
- **`refresh(now:context:)`** — the heart of the loop: decays needs from elapsed time (energy scaled by breed), derives health from neglect, tracks the critical-illness grace window, checks for death. Call on launch and before every interaction.
- **Death** — computed retroactively (old age from birth date; neglect after the grace window), filed to a `PetRecord`.
- **`PetRecord`** — immutable history entry per past pet (name, breed, born/died, cause, age, stage, steps).
- **`Player`** — profile + aggregates (`totalPetsRaised`, `longestLived`, streak, `gamesPlayed`/`gamesWon`/`winRate`) + one-pet-at-a-time relationship + pet/game history.
- **`PetConfig`** — all care-loop tuning knobs in one place.

### `PetArt.swift` — breeds, animation states, art pipeline
- **Two shared rigs** — `rig_cat` and `rig_dog` author every animation clip *once*; a breed is just a **skin** swap on the shared rig.
- **`Breed` + `BreedCatalog`** — pure data: each breed maps to a `BreedTrait` (kind, skin, lifespan, `energyMultiplier`, `playfulness`). 9 breeds defined (5 dogs, 4 cats).
- **`PetState`** — the animation vocabulary: passive looping states (idle, happy, hungry, sad, sleepy, sick, dead) chosen automatically by `displayState` from live stats; transient one-shots (eating, playing, beingPet, exercising, sleeping, arriving) fired by the UI.
- **Life stages** — newborn → baby (Kitten/Puppy) → juvenile → adult → senior.
- **Art pipeline:** AI-generate the *skins* (cheap, controllable) at build time; the rigs + clips are fixed. Cost = 2 rigs × ~13 clips (fixed) + 1 skin per breed (scales cheaply).

### `PetGames.swift` — game layer
- **`MiniGame` + `GameCatalog`** — 8 games as data (modes, reward stat, energy cost, `favoredTraits`, targets). Solo / versus / co-op.
- **Breed affinity** — `favoredTraits` × breed affinity scales a pet's score, so breed choice has real gameplay meaning (Bengal wins chase, Persian wins patience).
- **`GameSession`** — orchestrates the round-based flow (ready → play → exchange score → resolve) for solo, versus, and co-op.
- **`RoundTransport` protocol** — the seam Multipeer implements later; solo passes `nil`. No real-time sync.
- **`Pet.completeGame`** — routes the outcome through `refresh`: grants reward, costs energy. A wiped-out pet can't grind games.
- **`GameLog`** — per-game history feeding the `Player` leaderboard/stats.

---

## Suggested Build Order (updated)
1. ✅ **Pet engine + time-decay + death** (`PetModels.swift`)
2. ✅ **Breeds + animation states + art pipeline** (`PetArt.swift`)
3. ✅ **Game architecture** (`PetGames.swift`)
4. **Pet UI** — render `displayState` on the rig; the main care screen
5. **Persistence wiring + local notifications** — completes the daily loop; shippable
6. **Breed-selection / hatch screen**
7. **First minigame view** (solo) — calls `submitLocalScore`
8. **HealthKit exercise integration** — activity feeds the pet
9. **Widget** — glanceable status + interactive feed/pet buttons
10. **Multipeer transport** — implement `RoundTransport`; enable versus/co-op
11. Polish, sound, App Store prep

## Next Step
Build the **pet UI** that renders `displayState` on the shared rig — the main care screen people will live in — then wire persistence + notifications to close the daily loop.
