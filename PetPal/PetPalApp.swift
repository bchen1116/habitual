import SwiftUI
import SwiftData

@main
struct PetPalApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .modelContainer(for: [Pet.self, Player.self, PetRecord.self, GameLog.self])
    }
}
