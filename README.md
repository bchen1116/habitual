# PetPal 🐾

A Tamagotchi-inspired iOS app. Users care for a virtual pet — a specific **breed of cat or dog** — through a daily routine. The pet can live as an animated presence in a home-screen widget, its exercise responds to the user's real-world activity (HealthKit), and nearby friends can connect their phones to play games together.

> **Status:** Core architecture implemented (engine, breeds/art, games). UI, persistence wiring, HealthKit, widget, and Multipeer transport are next.

## Core design principles

- **Nothing runs in the background.** iOS suspends the app when closed, so every value — stat decay, growth, even death — is *computed from timestamps* when the app opens. No background timers.
- **One engine, one source of truth.** Every input (feeding, play, games, HealthKit activity) routes through `Pet.refresh(...)`. Games and activity *boost* the pet and *cost energy*; they never set stats raw and never gate survival.
- **Data-driven.** Adding a breed or a game is a one-line catalog entry — no logic changes.

## Project structure

```
Sources/
  Models/PetModels.swift   Core engine, persistence, decay, death, Player/PetRecord
  Art/PetArt.swift         Breeds, BreedCatalog, animation states, rig + skin pipeline
  Games/PetGames.swift     MiniGame catalog, round-based GameSession, transport seam
docs/
  virtual-pet-app-overview.md   Full project blueprint & decisions
```

## Architecture at a glance

| File | Contains |
|---|---|
| `PetModels.swift` | `Pet` (single living pet, snapshot stats + one timestamp), `refresh()` (decay → health → death), `PetRecord` (lifetime history), `Player` (aggregates + relationships), `PetConfig` (tuning) |
| `PetArt.swift` | `AnimalKind` (two shared rigs), `Breed` + `BreedCatalog` (9 breeds as data), `PetState` (animation vocabulary), `displayState` (stats → animation) |
| `PetGames.swift` | `MiniGame` + `GameCatalog` (8 games), `GameSession` (round-based flow), `RoundTransport` (Multipeer seam), `GameLog` |

## Tech stack

- **Swift + SwiftUI**, **SwiftData** for persistence — no backend for v1
- **WidgetKit** (glanceable status), **HealthKit** (activity → pet), **Multipeer Connectivity** (nearby round-based play)

## Getting started

These source files are framework-agnostic Swift. To build and run on a device:

1. Create a new iOS App in Xcode (SwiftUI lifecycle, SwiftData enabled).
2. Add the files under `Sources/` to the target.
3. Build the pet UI that renders `displayState`, then wire persistence + notifications.

See `docs/virtual-pet-app-overview.md` for the full build order and open questions.

## Roadmap

- [x] Pet engine + time-decay + death
- [x] Breeds + animation states + art pipeline
- [x] Game architecture (round-based, transport-agnostic)
- [ ] Pet UI (main care screen)
- [ ] Persistence wiring + local notifications
- [ ] Breed-selection / hatch screen
- [ ] First solo minigame view
- [ ] HealthKit exercise integration
- [ ] Home-screen widget
- [ ] Multipeer transport (versus / co-op)
- [ ] Polish, sound, App Store prep
