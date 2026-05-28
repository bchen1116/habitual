import SwiftUI
import SwiftData
import UserNotifications

@main
struct PetPalApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .task { await PetNotifications.requestAuthorization() }
        }
        .modelContainer(for: [Pet.self, Player.self, PetRecord.self, GameLog.self])
    }
}

// MARK: - Notifications
//
// Nothing runs while the app is suspended, so notifications have to be projected
// from the pet's current stats whenever state changes or the app backgrounds.
// The schedule is fully replaced on every reschedule — never additive.

enum PetNotifications {
    private static let nudgeID  = "petpal.nudge"
    private static let urgentID = "petpal.urgent"
    private static var managedIDs: [String] { [nudgeID, urgentID] }

    static func requestAuthorization() async {
        _ = try? await UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .badge, .sound])
    }

    /// Cancels pending PetPal notifications and reschedules them from the pet's
    /// current state. Call after interactions and on backgrounding.
    static func reschedule(for pet: Pet) {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: managedIDs)
        guard pet.isAlive else { return }

        let threshold = PetConfig.criticalThreshold
        let trait = pet.trait

        let projections: [(label: String, hours: Double)] = [
            ("hungry", hoursToThreshold(pet.hunger,    PetConfig.hungerDecayPerHour,    threshold)),
            ("lonely", hoursToThreshold(pet.happiness, PetConfig.happinessDecayPerHour, threshold)),
            ("tired",  hoursToThreshold(pet.energy,    PetConfig.energyDecayPerHour * trait.energyMultiplier, threshold)),
        ]

        let critCount = [pet.hunger, pet.happiness, pet.energy]
            .filter { $0 <= threshold }.count

        if critCount > 0 {
            // Already in trouble — nudge soon so the user gets a real ping.
            schedule(id: nudgeID,
                     title: pet.name,
                     body: "\(pet.name) needs you.",
                     after: 30 * 60)
        } else if let next = projections.filter({ $0.hours > 0.1 })
            .min(by: { $0.hours < $1.hours }) {
            schedule(id: nudgeID,
                     title: pet.name,
                     body: "\(pet.name) is getting \(next.label).",
                     after: next.hours * 3_600)
        }

        // Health is at zero and the grace window is counting down — last call.
        if let since = pet.criticalSince {
            let deadline = since.addingTimeInterval(PetConfig.deathGraceHours * 3_600)
            let seconds = deadline.timeIntervalSinceNow - 60  // alert 1 min before
            if seconds > 0 {
                schedule(id: urgentID,
                         title: "\(pet.name) is dying.",
                         body: "Come back now to save them.",
                         after: seconds)
            }
        }
    }

    private static func hoursToThreshold(_ value: Double, _ ratePerHour: Double, _ threshold: Double) -> Double {
        guard ratePerHour > 0 else { return .infinity }
        return max(0, (value - threshold) / ratePerHour)
    }

    private static func schedule(id: String, title: String, body: String, after seconds: TimeInterval) {
        guard seconds > 0 else { return }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: seconds, repeats: false)
        let request = UNNotificationRequest(identifier: id, content: content, trigger: trigger)
        UNUserNotificationCenter.current().add(request)
    }
}
