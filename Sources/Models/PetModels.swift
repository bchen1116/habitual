import Foundation
import SwiftData

// MARK: - Enums
//
// NOTE: species/breed traits (lifespan, energy, skin, rig) live in BreedCatalog
// over in PetArt.swift. The model just stores a `Breed` and reads `trait`.

enum LifeStage: String, Codable, CaseIterable, Comparable {
    case newborn, baby, juvenile, adult, senior

    private var order: Int { Self.allCases.firstIndex(of: self)! }
    static func < (l: LifeStage, r: LifeStage) -> Bool { l.order < r.order }
}

enum CauseOfDeath: String, Codable {
    case neglect   // health hit 0 and stayed there past the grace window
    case oldAge    // reached natural lifespan
}

// MARK: - Tuning (all on a 0...100 scale)

enum PetConfig {
    static let maxStat: Double = 100

    // How fast each need drains, in points per hour.
    static let hungerDecayPerHour: Double = 4
    static let happinessDecayPerHour: Double = 3
    static let energyDecayPerHour: Double = 5

    // Health is derived from neglect, not its own timer.
    static let criticalThreshold: Double = 15            // a need at/below this is "critical"
    static let healthPenaltyPerCriticalNeed: Double = 6  // health lost per hour, per critical need
    static let healthRegenPerHour: Double = 2            // health recovered per hour when all needs are fine

    // Once health hits 0 the pet is critically ill; it dies if not rescued within this window.
    static let deathGraceHours: Double = 6

    // Interaction boosts.
    static let feedBoost: Double = 35
    static let playBoost: Double = 30
    static let restBoost: Double = 40

    // HealthKit: how many real steps map to one point of pet energy.
    static let stepsPerEnergyPoint: Double = 200
}

// MARK: - Pet (the single living pet)

@Model
final class Pet {
    var name: String
    var breed: Breed
    var birthDate: Date
    var isAlive: Bool

    // Stat SNAPSHOTS — the value as of `statsUpdatedAt`. Never read these directly
    // for display; call refresh(...) first (or use the computed accessors).
    var hunger: Double
    var happiness: Double
    var energy: Double
    var health: Double

    /// The single timestamp the snapshots above are valid for. Everything is computed from this.
    var statsUpdatedAt: Date

    /// Set the moment health first reaches 0; cleared on rescue. Drives the death grace window.
    var criticalSince: Date?

    // For UI / notifications.
    var lastFed: Date?
    var lastPlayed: Date?
    var lastRested: Date?

    // HealthKit double-count guard + lifetime tally.
    var lastHealthSyncAt: Date?
    var totalStepsContributed: Int

    var owner: Player?

    init(name: String, breed: Breed, now: Date = .now) {
        self.name = name
        self.breed = breed
        self.birthDate = now
        self.isAlive = true
        self.hunger = 80
        self.happiness = 80
        self.energy = 80
        self.health = 100
        self.statsUpdatedAt = now
        self.totalStepsContributed = 0
    }
}

extension Pet {

    func clamp(_ v: Double) -> Double { min(PetConfig.maxStat, max(0, v)) }

    /// Age-driven life stage (lifespan comes from the breed trait).
    func stage(at date: Date = .now) -> LifeStage {
        let days = date.timeIntervalSince(birthDate) / 86_400
        let span = trait.lifespanDays
        switch days {
        case ..<0.5:            return .newborn
        case ..<(span * 0.15):  return .baby      // Kitten / Puppy (trait.babyName)
        case ..<(span * 0.5):   return .juvenile
        case ..<(span * 0.85):  return .adult
        default:                return .senior
        }
    }

    /// THE core loop. Call on app launch and at the start of every interaction.
    /// Brings the snapshots up to `now` purely from elapsed time, then checks for death.
    func refresh(now: Date = .now, context: ModelContext) {
        guard isAlive else { return }
        let hours = now.timeIntervalSince(statsUpdatedAt) / 3_600
        guard hours > 0 else { return }

        let prevHunger = hunger
        let prevHappiness = happiness
        let prevEnergy = energy
        let prevHealth = health

        // 1. Needs decay linearly. Energy drains faster for high-energy breeds,
        //    which is what makes the HealthKit exercise feature matter per breed.
        hunger    = clamp(hunger    - PetConfig.hungerDecayPerHour    * hours)
        happiness = clamp(happiness - PetConfig.happinessDecayPerHour * hours)
        energy    = clamp(energy    - PetConfig.energyDecayPerHour * trait.energyMultiplier * hours)

        // 2. Health reacts to neglect. (Uses post-decay values — a fair approximation;
        //    for very long gaps you could sub-sample the interval for more precision.)
        let criticalCount = [hunger, happiness, energy]
            .filter { $0 <= PetConfig.criticalThreshold }.count
        if criticalCount == 0 {
            health = clamp(health + PetConfig.healthRegenPerHour * hours)
        } else {
            let damage = Double(criticalCount) * PetConfig.healthPenaltyPerCriticalNeed * hours
            health = clamp(health - damage)
        }

        // 3. Track the critical-illness window, retroactively when needed.
        if health <= 0 {
            if criticalSince == nil {
                let zeroHours = healthZeroHours(
                    prevHunger: prevHunger, prevHappiness: prevHappiness,
                    prevEnergy: prevEnergy, prevHealth: prevHealth,
                    totalHours: hours
                )
                criticalSince = statsUpdatedAt.addingTimeInterval(zeroHours * 3_600)
            }
        } else {
            criticalSince = nil
        }

        statsUpdatedAt = now
        checkForDeath(now: now, context: context)
    }

    /// Walks the decay timeline piecewise to find when health first reached zero.
    private func healthZeroHours(
        prevHunger: Double, prevHappiness: Double, prevEnergy: Double,
        prevHealth: Double, totalHours: Double
    ) -> Double {
        let threshold = PetConfig.criticalThreshold
        func critHours(_ value: Double, _ rate: Double) -> Double {
            value <= threshold ? 0 : (value - threshold) / rate
        }

        let needCritTimes = [
            critHours(prevHunger, PetConfig.hungerDecayPerHour),
            critHours(prevHappiness, PetConfig.happinessDecayPerHour),
            critHours(prevEnergy, PetConfig.energyDecayPerHour * trait.energyMultiplier),
        ].sorted()

        var boundaries = [0.0]
        for t in needCritTimes where t > 0 && t < totalHours {
            if boundaries.last != t { boundaries.append(t) }
        }
        boundaries.append(totalHours)

        var hp = prevHealth

        for i in 0..<(boundaries.count - 1) {
            let segStart = boundaries[i]
            let segEnd = boundaries[i + 1]
            let duration = segEnd - segStart
            if duration <= 0 { continue }

            let critCount = needCritTimes.filter { $0 <= segStart }.count
            let rate: Double = critCount == 0
                ? PetConfig.healthRegenPerHour
                : -Double(critCount) * PetConfig.healthPenaltyPerCriticalNeed

            if rate < 0 && hp > 0 {
                let hoursToZero = hp / (-rate)
                if hoursToZero <= duration { return segStart + hoursToZero }
            }

            hp = min(PetConfig.maxStat, max(0, hp + rate * duration))
        }

        return totalHours
    }

    private func checkForDeath(now: Date, context: ModelContext) {
        // Old age — exact, computed from birth.
        let deathByAge = birthDate.addingTimeInterval(trait.lifespanDays * 86_400)
        if now >= deathByAge {
            die(cause: .oldAge, at: deathByAge, context: context)
            return
        }
        // Neglect — only after the grace window elapses at 0 health.
        if let since = criticalSince,
           now.timeIntervalSince(since) >= PetConfig.deathGraceHours * 3_600 {
            die(cause: .neglect,
                at: since.addingTimeInterval(PetConfig.deathGraceHours * 3_600),
                context: context)
        }
    }

    private func die(cause: CauseOfDeath, at date: Date, context: ModelContext) {
        guard isAlive else { return }
        isAlive = false
        let record = PetRecord(from: self, diedAt: date, cause: cause)
        context.insert(record)
        owner?.recordDeath(record)
    }

    // MARK: Interactions (each refreshes first so boosts apply to the live state)

    func feed(now: Date = .now, context: ModelContext) {
        refresh(now: now, context: context); guard isAlive else { return }
        hunger = clamp(hunger + PetConfig.feedBoost)
        lastFed = now; statsUpdatedAt = now
    }

    func play(now: Date = .now, context: ModelContext) {
        refresh(now: now, context: context); guard isAlive else { return }
        happiness = clamp(happiness + PetConfig.playBoost)
        energy = clamp(energy - 10)        // playing tires the pet a little
        lastPlayed = now; statsUpdatedAt = now
    }

    func rest(now: Date = .now, context: ModelContext) {
        refresh(now: now, context: context); guard isAlive else { return }
        energy = clamp(energy + PetConfig.restBoost)
        lastRested = now; statsUpdatedAt = now
    }

    /// Apply NEW activity since the last sync. The HealthKit layer is responsible for
    /// querying steps since `lastHealthSyncAt` and passing only the delta here.
    func applyActivity(newSteps: Int, now: Date = .now, context: ModelContext) {
        refresh(now: now, context: context); guard isAlive, newSteps > 0 else { return }
        let boost = Double(newSteps) / PetConfig.stepsPerEnergyPoint
        energy = clamp(energy + boost)
        happiness = clamp(happiness + boost * 0.5)   // activity boosts, never gates survival
        totalStepsContributed += newSteps
        lastHealthSyncAt = now; statsUpdatedAt = now
    }
}

// MARK: - PetRecord (lifetime history of past pets)

@Model
final class PetRecord {
    var name: String
    var breed: Breed
    var bornAt: Date
    var diedAt: Date
    var causeOfDeath: CauseOfDeath
    var maxStageReached: LifeStage
    var totalStepsContributed: Int
    var owner: Player?

    var ageDays: Double { diedAt.timeIntervalSince(bornAt) / 86_400 }

    init(from pet: Pet, diedAt: Date, cause: CauseOfDeath) {
        self.name = pet.name
        self.breed = pet.breed
        self.bornAt = pet.birthDate
        self.diedAt = diedAt
        self.causeOfDeath = cause
        self.maxStageReached = pet.stage(at: diedAt)
        self.totalStepsContributed = pet.totalStepsContributed
    }
}

// MARK: - Player (one per user: profile + aggregate stats + history)

@Model
final class Player {
    var totalPetsRaised: Int
    var currentStreakDays: Int
    var lastActiveDate: Date?

    // Game aggregates.
    var gamesPlayed: Int
    var gamesWon: Int

    @Relationship(deleteRule: .nullify, inverse: \Pet.owner)
    var currentPet: Pet?

    @Relationship(deleteRule: .cascade, inverse: \PetRecord.owner)
    var history: [PetRecord]

    @Relationship(deleteRule: .cascade, inverse: \GameLog.owner)
    var gameLog: [GameLog]

    init() {
        self.totalPetsRaised = 0
        self.currentStreakDays = 0
        self.gamesPlayed = 0
        self.gamesWon = 0
        self.history = []
        self.gameLog = []
    }

    var longestLived: PetRecord? { history.max { $0.ageDays < $1.ageDays } }
    var winRate: Double { gamesPlayed == 0 ? 0 : Double(gamesWon) / Double(gamesPlayed) }

    /// Files a finished game (called by GameSession after routing the reward).
    func recordGame(_ log: GameLog) {
        log.owner = self
        gameLog.append(log)
        gamesPlayed += 1
        if log.didWin { gamesWon += 1 }
    }

    /// Called by Pet.die(). Files the record and clears the living slot.
    func recordDeath(_ record: PetRecord) {
        record.owner = self
        history.append(record)
        totalPetsRaised += 1
        currentPet = nil
    }

    /// Hatch a new pet (only allowed when no pet is currently alive).
    @discardableResult
    func startNewPet(name: String, breed: Breed,
                     now: Date = .now, context: ModelContext) -> Pet? {
        guard currentPet == nil else { return nil }   // one pet at a time
        let pet = Pet(name: name, breed: breed, now: now)
        context.insert(pet)
        currentPet = pet
        return pet
    }
}
