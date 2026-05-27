import Foundation
import SwiftData
import Combine

// MARK: - Taxonomy

enum GameMode: String, Codable, CaseIterable {
    case solo      // single device, beat a target / AI
    case versus    // two nearby devices, higher score wins
    case coop      // two nearby devices, combined score must clear a goal
}

/// Traits a game rewards. A breed's affinity for these scales its performance,
/// which is what gives breed choice real meaning in multiplayer.
enum GameTrait: String, Codable { case energy, playfulness, calm }

/// Which pet stat a game tops up. ALWAYS applied through the engine, never set raw.
enum RewardStat: String, Codable { case happiness, energy }

// MARK: - Game catalog (add a game = one entry, just like a breed)

enum MiniGame: String, Codable, CaseIterable {
    case fetch, laserChase, treatRhythm          // solo-friendly
    case agilityRace, tugOfWar, trickOff, patienceContest  // head-to-head
    case coopTrick                                // co-op
}

struct GameInfo {
    let displayName: String
    let modes: Set<GameMode>
    let reward: RewardStat
    let energyCost: Double        // playing tires the pet — keeps the care loop honest
    let baseReward: Double        // stat granted for a strong result
    let favoredTraits: [GameTrait]
    let soloTarget: Int           // score that counts as a win in solo
    let coopGoal: Int             // combined score needed in co-op
}

enum GameCatalog {
    static let info: [MiniGame: GameInfo] = [
        .fetch:           .init(displayName: "Fetch",            modes: [.solo, .versus], reward: .happiness, energyCost: 12, baseReward: 25, favoredTraits: [.playfulness, .energy], soloTarget: 60, coopGoal: 120),
        .laserChase:      .init(displayName: "Laser Chase",      modes: [.solo],          reward: .happiness, energyCost: 10, baseReward: 22, favoredTraits: [.playfulness],          soloTarget: 50, coopGoal: 100),
        .treatRhythm:     .init(displayName: "Treat Rhythm",     modes: [.solo],          reward: .happiness, energyCost: 6,  baseReward: 18, favoredTraits: [.calm],                 soloTarget: 70, coopGoal: 140),
        .agilityRace:     .init(displayName: "Agility Race",     modes: [.versus, .coop], reward: .happiness, energyCost: 16, baseReward: 30, favoredTraits: [.energy],               soloTarget: 60, coopGoal: 110),
        .tugOfWar:        .init(displayName: "Tug-of-War",       modes: [.versus],        reward: .happiness, energyCost: 15, baseReward: 28, favoredTraits: [.energy, .playfulness], soloTarget: 60, coopGoal: 120),
        .trickOff:        .init(displayName: "Trick-Off",        modes: [.versus],        reward: .happiness, energyCost: 8,  baseReward: 26, favoredTraits: [.calm],                 soloTarget: 60, coopGoal: 120),
        .patienceContest: .init(displayName: "Patience Contest", modes: [.versus],        reward: .happiness, energyCost: 4,  baseReward: 24, favoredTraits: [.calm],                 soloTarget: 60, coopGoal: 120),
        .coopTrick:       .init(displayName: "Co-op Trick",      modes: [.coop],          reward: .happiness, energyCost: 10, baseReward: 32, favoredTraits: [.playfulness, .calm],  soloTarget: 60, coopGoal: 130),
    ]
    static func info(_ g: MiniGame) -> GameInfo { info[g]! }
}

// MARK: - Breed affinity (breeds play to their strengths)

extension BreedTrait {
    /// Roughly 0.5...1.6: how well this breed suits a game trait.
    func affinity(for t: GameTrait) -> Double {
        switch t {
        case .energy:      return energyMultiplier
        case .playfulness: return playfulness
        case .calm:        return max(0.5, 2 - max(energyMultiplier, playfulness)) // calmer = lower drive
        }
    }
}

// MARK: - Results

struct GameResult {
    let petName: String
    let score: Int          // effective (post-affinity) score
}

struct GameOutcome {
    let game: MiniGame
    let mode: GameMode
    let local: GameResult
    let opponent: GameResult?   // nil for solo
    let didWin: Bool            // versus: higher score · coop: goal met · solo: beat target
}

// MARK: - Transport seam
//
// Round-based, NOT real-time. We exchange one tiny score message per round, so
// there's no lockstep netcode. Multipeer (or a relay) implements this protocol later.

protocol RoundTransport: AnyObject {
    var isConnected: Bool { get }
    func signalReady()
    func send(score: Int)
    var onOpponentReady: (() -> Void)? { get set }
    var onOpponentScore: ((_ score: Int, _ opponentPetName: String) -> Void)? { get set }
}

// MARK: - Session orchestrator (the view drives this; gameplay reports a raw score)

enum GamePhase { case connecting, ready, playing, awaitingOpponent, finished }

@MainActor
final class GameSession: ObservableObject {
    let game: MiniGame
    let mode: GameMode
    let pet: Pet

    @Published private(set) var phase: GamePhase
    @Published private(set) var outcome: GameOutcome?

    private let context: ModelContext
    private let transport: RoundTransport?   // nil for solo
    private var localScore: Int?
    private var opponentScore: Int?
    private var opponentName = "Rival"
    private var localReady = false
    private var opponentReady = false

    init(game: MiniGame, mode: GameMode, pet: Pet,
         context: ModelContext, transport: RoundTransport? = nil) {
        self.game = game
        self.mode = mode
        self.pet = pet
        self.context = context
        self.transport = transport
        self.phase = (mode == .solo) ? .ready : .connecting
    }

    func start() {
        guard mode != .solo, let transport else { phase = .ready; return }
        transport.onOpponentReady = { [weak self] in self?.opponentReady = true; self?.maybeBegin() }
        transport.onOpponentScore = { [weak self] score, name in
            self?.opponentScore = score
            self?.opponentName = name
            self?.tryResolve()
        }
        localReady = true
        transport.signalReady()
        maybeBegin()
    }

    private func maybeBegin() {
        if mode == .solo || (localReady && opponentReady) { phase = .playing }
    }

    /// Called by the minigame view when its round ends. `raw` is the gameplay score
    /// before breed affinity is applied.
    func submitLocalScore(_ raw: Int) {
        let score = effectiveScore(raw)
        localScore = score
        transport?.send(score: score)
        tryResolve()
    }

    private func tryResolve() {
        guard let mine = localScore else { return }
        let cfg = GameCatalog.info(game)

        var didWin: Bool
        var opp: GameResult?
        switch mode {
        case .solo:
            didWin = mine >= cfg.soloTarget
        case .versus:
            guard let o = opponentScore else { phase = .awaitingOpponent; return }
            didWin = mine >= o
            opp = GameResult(petName: opponentName, score: o)
        case .coop:
            guard let o = opponentScore else { phase = .awaitingOpponent; return }
            didWin = (mine + o) >= cfg.coopGoal
            opp = GameResult(petName: opponentName, score: o)
        }

        let result = GameOutcome(game: game, mode: mode,
                                 local: GameResult(petName: pet.name, score: mine),
                                 opponent: opp, didWin: didWin)

        // Route through the engine + record it. Single source of truth preserved.
        pet.completeGame(result, context: context)
        let log = GameLog(outcome: result)
        context.insert(log)
        pet.owner?.recordGame(log)

        outcome = result
        phase = .finished
    }

    private func effectiveScore(_ raw: Int) -> Int {
        let aff = GameCatalog.info(game).favoredTraits
            .map { pet.trait.affinity(for: $0) }.max() ?? 1.0
        return Int(Double(raw) * aff)
    }
}

// MARK: - Engine routing (games are just another input to the existing loop)

extension Pet {
    /// Apply a finished game THROUGH the engine: costs energy, grants the reward
    /// stat scaled by performance. Never bypasses refresh or the "boost, not gate" rule.
    func completeGame(_ outcome: GameOutcome, now: Date = .now, context: ModelContext) {
        refresh(now: now, context: context); guard isAlive else { return }
        let cfg = GameCatalog.info(outcome.game)
        let performance = outcome.didWin ? 1.0 : 0.5
        let gain = cfg.baseReward * performance

        func clamp(_ v: Double) -> Double { min(PetConfig.maxStat, max(0, v)) }
        switch cfg.reward {
        case .happiness: happiness = clamp(happiness + gain)
        case .energy:    energy = clamp(energy + gain)
        }
        energy = clamp(energy - cfg.energyCost)   // play tires the pet
        lastPlayed = now
        statsUpdatedAt = now
    }
}

// MARK: - History

@Model
final class GameLog {
    var game: MiniGame
    var mode: GameMode
    var didWin: Bool
    var localScore: Int
    var opponentScore: Int?
    var opponentName: String?
    var playedAt: Date
    var owner: Player?

    init(outcome: GameOutcome, playedAt: Date = .now) {
        self.game = outcome.game
        self.mode = outcome.mode
        self.didWin = outcome.didWin
        self.localScore = outcome.local.score
        self.opponentScore = outcome.opponent?.score
        self.opponentName = outcome.opponent?.petName
        self.playedAt = playedAt
    }
}
