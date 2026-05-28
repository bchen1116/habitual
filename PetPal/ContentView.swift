import SwiftUI
import SwiftData

// MARK: - Root router

struct ContentView: View {
    @Query private var players: [Player]
    @Environment(\.modelContext) private var modelContext

    var body: some View {
        NavigationStack {
            Group {
                if let player = players.first {
                    if let pet = player.currentPet, pet.isAlive {
                        PetCareView(pet: pet)
                    } else {
                        HatchView(player: player)
                    }
                } else {
                    ProgressView().task {
                        if players.isEmpty { modelContext.insert(Player()) }
                    }
                }
            }
        }
    }
}

// MARK: - Pet care screen

struct PetCareView: View {
    let pet: Pet
    @Environment(\.modelContext) private var modelContext
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        VStack(spacing: 20) {
            Spacer(minLength: 0)

            PetSprite(pet: pet)

            VStack(spacing: 2) {
                Text(pet.name).font(.title2).fontWeight(.bold)
                Text("\(pet.trait.displayName) · \(pet.stage(at: .now).rawValue.capitalized)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text(pet.displayState.rawValue.capitalized)
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }

            VStack(spacing: 10) {
                StatBar(label: "Hunger",    value: pet.hunger,    tint: .orange)
                StatBar(label: "Happiness", value: pet.happiness, tint: .pink)
                StatBar(label: "Energy",    value: pet.energy,    tint: .yellow)
                StatBar(label: "Health",    value: pet.health,    tint: .red)
            }
            .padding(.horizontal)

            HStack(spacing: 12) {
                ActionButton(title: "Feed", systemImage: "fork.knife", tint: .orange) {
                    perform { pet.feed(context: modelContext) }
                }
                ActionButton(title: "Play", systemImage: "tennisball.fill", tint: .pink) {
                    perform { pet.play(context: modelContext) }
                }
                ActionButton(title: "Rest", systemImage: "moon.fill", tint: .indigo) {
                    perform { pet.rest(context: modelContext) }
                }
            }
            .padding(.horizontal)

            Spacer(minLength: 0)
        }
        .navigationTitle("PetPal")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { pet.refresh(context: modelContext) }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                pet.refresh(context: modelContext)
            case .background:
                pet.refresh(context: modelContext)
                PetNotifications.reschedule(for: pet)
            default:
                break
            }
        }
    }

    private func perform(_ action: () -> Void) {
        action()
        PetNotifications.reschedule(for: pet)
    }
}

private struct StatBar: View {
    let label: String
    let value: Double
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label).font(.caption).foregroundStyle(.secondary)
                Spacer()
                Text("\(Int(value))")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(tint.opacity(0.15))
                    Capsule().fill(tint).frame(width: proxy.size.width * (value / 100))
                }
            }
            .frame(height: 8)
        }
    }
}

private struct ActionButton: View {
    let title: String
    let systemImage: String
    let tint: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: systemImage).font(.title2)
                Text(title).font(.caption)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .foregroundStyle(tint)
            .background(tint.opacity(0.15), in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Hatch screen

struct HatchView: View {
    let player: Player
    @Environment(\.modelContext) private var modelContext
    @State private var selected: Breed = .borderCollie
    @State private var name: String = ""

    var body: some View {
        Form {
            Section("Name") {
                TextField("Pet name", text: $name)
            }
            Section("Breed") {
                Picker("Breed", selection: $selected) {
                    ForEach(Breed.allCases, id: \.self) { b in
                        Text(BreedCatalog.trait(b).displayName).tag(b)
                    }
                }
                .pickerStyle(.inline)
                .labelsHidden()
            }
            if !player.history.isEmpty {
                Section("Memorial") {
                    ForEach(player.history.suffix(3).reversed(), id: \.persistentModelID) { record in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(record.name).fontWeight(.semibold)
                                Text("\(BreedCatalog.trait(record.breed).displayName) · \(Int(record.ageDays)) days")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(record.causeOfDeath == .oldAge ? "Old age" : "Neglect")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .navigationTitle(player.history.isEmpty ? "Hatch your pet" : "Hatch a new pet")
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Hatch") {
                    let trimmed = name.trimmingCharacters(in: .whitespaces)
                    if let pet = player.startNewPet(name: trimmed, breed: selected, context: modelContext) {
                        PetNotifications.reschedule(for: pet)
                    }
                }
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }
}

// MARK: - Pet sprite (placeholder layered blob)
//
// The pet renders as a stack of layers (body → head → eyes → mouth). Each layer
// will become a pixel-art Image with `.interpolation(.none)` once assets exist;
// for now they render as shapes so the composition is wired in. Extract this
// section into its own file once real sprite work begins.

enum PetLayer: String, CaseIterable {
    case body, head, eyes, mouth
}

struct PetSprite: View {
    let pet: Pet
    var size: CGFloat = 160

    @State private var bounce = false

    var body: some View {
        ZStack {
            ForEach(PetLayer.allCases, id: \.self) { layer in
                layerView(for: layer)
            }
        }
        .frame(width: size, height: size)
        .offset(y: bounce ? -3 : 3)
        .animation(.easeInOut(duration: bounceDuration).repeatForever(autoreverses: true), value: bounce)
        .saturation(pet.displayState == .sick || pet.displayState == .dead ? 0.3 : 1)
        .opacity(pet.displayState == .dead ? 0.5 : 1)
        .onAppear { bounce = true }
    }

    private var bounceDuration: Double {
        switch pet.displayState {
        case .happy: 0.45
        case .sleepy, .sick: 2.0
        case .dead: 60.0
        default: 1.0
        }
    }

    private var tint: Color {
        pet.trait.kind == .cat ? .orange : .brown
    }

    @ViewBuilder
    private func layerView(for layer: PetLayer) -> some View {
        switch layer {
        case .body:
            Capsule()
                .fill(tint)
                .frame(width: size * 0.7, height: size * 0.55)
                .offset(y: size * 0.13)
        case .head:
            Circle()
                .fill(tint)
                .frame(width: size * 0.5, height: size * 0.5)
                .offset(y: -size * 0.13)
        case .eyes:
            HStack(spacing: size * 0.1) {
                eye
                eye
            }
            .offset(y: -size * 0.18)
        case .mouth:
            mouth.offset(y: -size * 0.05)
        }
    }

    private var eye: some View {
        Group {
            if pet.displayState == .sleepy || pet.displayState == .dead {
                Capsule().fill(.black).frame(width: size * 0.07, height: size * 0.015)
            } else {
                Circle().fill(.black).frame(width: size * 0.055, height: size * 0.055)
            }
        }
    }

    @ViewBuilder
    private var mouth: some View {
        let w = size * 0.18
        switch pet.displayState {
        case .happy:
            Path { p in
                p.move(to: CGPoint(x: 0, y: 0))
                p.addQuadCurve(to: CGPoint(x: w, y: 0), control: CGPoint(x: w / 2, y: w / 2))
            }
            .stroke(.black, style: StrokeStyle(lineWidth: 2, lineCap: .round))
            .frame(width: w, height: w / 2)
        case .sad, .sick, .hungry:
            Path { p in
                p.move(to: CGPoint(x: 0, y: w / 2))
                p.addQuadCurve(to: CGPoint(x: w, y: w / 2), control: CGPoint(x: w / 2, y: 0))
            }
            .stroke(.black, style: StrokeStyle(lineWidth: 2, lineCap: .round))
            .frame(width: w, height: w / 2)
        default:
            Capsule().fill(.black).frame(width: size * 0.1, height: 2)
        }
    }
}

#Preview {
    ContentView()
        .modelContainer(for: [Pet.self, Player.self, PetRecord.self, GameLog.self], inMemory: true)
}
