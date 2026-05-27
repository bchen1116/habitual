import Foundation

// MARK: - Animal kind & rig
//
// Two shared skeletal rigs power EVERYTHING. A breed picks a rig (via its kind)
// and a SKIN. A breed never needs its own animation clips — it reuses the rig's.

enum AnimalKind: String, Codable {
    case cat, dog
    var rigName: String { self == .cat ? "rig_cat" : "rig_dog" }
}

// MARK: - Animation states
//
// One named clip per state, authored once per rig and reused by every breed of
// that kind. Passive states are chosen automatically from the pet's live stats;
// transient states are one-shots fired by the UI on an action, then it returns
// to the passive state.

enum PetState: String, CaseIterable {
    // Passive / looping — derived from current stats.
    case idle        // content default loop
    case happy       // high happiness
    case hungry      // low hunger
    case sad         // low happiness / lonely
    case sleepy      // low energy
    case sick        // critical health
    case dead        // not alive — memorial pose

    // Transient / one-shot — play once, then fall back to a passive state.
    case eating
    case playing
    case beingPet
    case exercising  // fired by a HealthKit activity boost
    case sleeping    // fired by rest
    case arriving    // intro when a new pet is born

    var isLooping: Bool {
        switch self {
        case .idle, .happy, .hungry, .sad, .sleepy, .sick, .dead: return true
        default: return false
        }
    }

    /// The clip name the rig exposes for this state (e.g. "anim_idle").
    var clipName: String { "anim_\(rawValue)" }
}

// MARK: - Breeds (pure data — adding one is a single line, no logic changes)

enum Breed: String, Codable, CaseIterable {
    // dogs
    case borderCollie, goldenRetriever, frenchBulldog, greatDane, chihuahua
    // cats
    case persian, bengal, maineCoon, siamese
}

struct BreedTrait {
    let kind: AnimalKind
    let displayName: String
    let skin: String           // texture/skin asset set applied to the shared rig
    let lifespanDays: Double    // game-scaled from real breed averages
    let energyMultiplier: Double // >1 drains energy faster → needs more activity/play
    let playfulness: Double      // how much play/activity it craves

    var rigName: String { kind.rigName }
    /// What this animal is called as a baby, for stage labels.
    var babyName: String { kind == .cat ? "Kitten" : "Puppy" }
}

enum BreedCatalog {
    static let traits: [Breed: BreedTrait] = [
        .borderCollie:    .init(kind: .dog, displayName: "Border Collie",    skin: "skin_border_collie",    lifespanDays: 16, energyMultiplier: 1.6, playfulness: 1.5),
        .goldenRetriever: .init(kind: .dog, displayName: "Golden Retriever", skin: "skin_golden_retriever", lifespanDays: 13, energyMultiplier: 1.3, playfulness: 1.3),
        .frenchBulldog:   .init(kind: .dog, displayName: "French Bulldog",   skin: "skin_french_bulldog",   lifespanDays: 11, energyMultiplier: 0.7, playfulness: 0.8),
        .greatDane:       .init(kind: .dog, displayName: "Great Dane",       skin: "skin_great_dane",       lifespanDays: 9,  energyMultiplier: 0.9, playfulness: 0.9),
        .chihuahua:       .init(kind: .dog, displayName: "Chihuahua",        skin: "skin_chihuahua",        lifespanDays: 17, energyMultiplier: 1.1, playfulness: 1.0),
        .persian:         .init(kind: .cat, displayName: "Persian",          skin: "skin_persian",          lifespanDays: 15, energyMultiplier: 0.6, playfulness: 0.6),
        .bengal:          .init(kind: .cat, displayName: "Bengal",           skin: "skin_bengal",           lifespanDays: 15, energyMultiplier: 1.5, playfulness: 1.4),
        .maineCoon:       .init(kind: .cat, displayName: "Maine Coon",       skin: "skin_maine_coon",       lifespanDays: 14, energyMultiplier: 1.0, playfulness: 1.1),
        .siamese:         .init(kind: .cat, displayName: "Siamese",          skin: "skin_siamese",          lifespanDays: 18, energyMultiplier: 1.2, playfulness: 1.3),
    ]
    static func trait(_ b: Breed) -> BreedTrait { traits[b]! }
}

// MARK: - Deriving the visible state from the engine

extension Pet {
    var trait: BreedTrait { BreedCatalog.trait(breed) }

    /// The passive animation state to show right now, derived from live stats.
    /// Call refresh(...) before reading this in the UI so it reflects "now".
    /// Action one-shots (.eating, .playing, …) are triggered by the view and
    /// then return to this state.
    var displayState: PetState {
        guard isAlive else { return .dead }
        if health    <= PetConfig.criticalThreshold { return .sick }
        if energy    <= PetConfig.criticalThreshold { return .sleepy }
        if hunger    <= PetConfig.criticalThreshold { return .hungry }
        if happiness <= PetConfig.criticalThreshold { return .sad }
        if happiness >= 80                           { return .happy }
        return .idle
    }
}
