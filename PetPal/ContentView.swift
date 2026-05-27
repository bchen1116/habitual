import SwiftUI
import SwiftData

struct ContentView: View {
    @Query private var players: [Player]
    @Environment(\.modelContext) private var modelContext

    var body: some View {
        NavigationStack {
            if let player = players.first, let pet = player.currentPet, pet.isAlive {
                PetCareView(pet: pet)
            } else {
                Text("PetPal")
                    .font(.largeTitle)
                    .fontWeight(.bold)
            }
        }
    }
}

struct PetCareView: View {
    let pet: Pet

    var body: some View {
        VStack(spacing: 24) {
            Text(pet.name)
                .font(.title)
                .fontWeight(.bold)

            Text(pet.trait.displayName)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            Text(pet.displayState.rawValue.capitalized)
                .font(.headline)
        }
        .padding()
        .navigationTitle("PetPal")
    }
}

#Preview {
    ContentView()
        .modelContainer(for: [Pet.self, Player.self, PetRecord.self, GameLog.self], inMemory: true)
}
