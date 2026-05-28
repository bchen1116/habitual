import SwiftUI
import SwiftData

// MARK: - Screen wrapper
//
// Owns the GameSession across the sheet's lifetime. Each presentation creates
// a fresh session; @StateObject keeps it stable across re-renders within one
// presentation.

struct LaserChaseScreen: View {
    @StateObject private var session: GameSession

    init(pet: Pet, context: ModelContext) {
        _session = StateObject(wrappedValue: GameSession(
            game: .laserChase, mode: .solo, pet: pet, context: context
        ))
    }

    var body: some View {
        LaserChaseView(session: session)
    }
}

// MARK: - Tuning
//
// 30-second round. Spawn interval shortens and dwell time tightens linearly
// across the round so the difficulty ramps. With these numbers a skilled
// player hits ~48 raw points — comfortable for high-playfulness breeds (Border
// Collie, Bengal) and out of reach for low-playfulness ones (Persian).

private enum LaserConfig {
    static let totalDuration: TimeInterval = 30
    static let startSpawnInterval: TimeInterval = 0.8
    static let endSpawnInterval: TimeInterval = 0.4
    static let startDwell: TimeInterval = 1.4
    static let endDwell: TimeInterval = 1.0
    static let gridDimension: Int = 4
    static var cellCount: Int { gridDimension * gridDimension }
}

private struct LaserCell: Equatable {
    var spawnedAt: Date?
    var dwell: TimeInterval = 0
    var isActive: Bool { spawnedAt != nil }
}

// MARK: - Game view

struct LaserChaseView: View {
    @ObservedObject var session: GameSession
    @Environment(\.dismiss) private var dismiss

    @State private var cells: [LaserCell] = Array(repeating: LaserCell(), count: LaserConfig.cellCount)
    @State private var score = 0
    @State private var roundStart: Date = .distantPast
    @State private var nextSpawn: Date = .distantFuture
    @State private var ticker: Timer?
    @State private var displayedTime: TimeInterval = LaserConfig.totalDuration

    var body: some View {
        Group {
            switch session.phase {
            case .ready, .connecting: intro
            case .playing:            gameplay
            case .finished:           result
            default:                  ProgressView()
            }
        }
        .navigationTitle("Laser Chase")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Close") { dismiss() }
            }
        }
        .onDisappear { stopTicker() }
    }

    private var intro: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "scope")
                .font(.system(size: 80))
                .foregroundStyle(.red)
            Text("Tap the lasers as fast as you can.")
                .font(.headline)
                .multilineTextAlignment(.center)
            Text("\(Int(LaserConfig.totalDuration))s · target \(GameCatalog.info(.laserChase).soloTarget)")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Spacer()
            Button("Start") { begin() }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            Spacer()
        }
        .padding()
    }

    private var gameplay: some View {
        VStack(spacing: 16) {
            HStack {
                Label("\(score)", systemImage: "bolt.fill")
                    .font(.title3.bold().monospacedDigit())
                    .foregroundStyle(.yellow)
                Spacer()
                Text("\(Int(ceil(displayedTime)))s")
                    .font(.title3.monospacedDigit())
                    .foregroundStyle(displayedTime < 5 ? .red : .primary)
            }
            .padding(.horizontal)

            LazyVGrid(
                columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: LaserConfig.gridDimension),
                spacing: 8
            ) {
                ForEach(0..<LaserConfig.cellCount, id: \.self) { i in
                    LaserCellView(active: cells[i].isActive)
                        .aspectRatio(1, contentMode: .fit)
                        .contentShape(Rectangle())
                        .onTapGesture { tap(at: i) }
                }
            }
            .padding(.horizontal)
            Spacer()
        }
        .padding(.vertical)
    }

    private var result: some View {
        VStack(spacing: 20) {
            Spacer()
            if let outcome = session.outcome {
                Image(systemName: outcome.didWin ? "star.fill" : "star")
                    .font(.system(size: 80))
                    .foregroundStyle(outcome.didWin ? .yellow : .gray)
                Text(outcome.didWin ? "Caught it!" : "Just missed it")
                    .font(.largeTitle.bold())
                VStack(spacing: 4) {
                    Text("Score: \(outcome.local.score)")
                        .font(.title2)
                    if score > 0 {
                        let bonus = Double(outcome.local.score) / Double(score)
                        if abs(bonus - 1.0) > 0.05 {
                            Text(String(format: "Caught %d · breed bonus ×%.1f", score, bonus))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Text("Target: \(GameCatalog.info(.laserChase).soloTarget)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            Button("Done") { dismiss() }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            Spacer()
        }
        .padding()
    }

    // MARK: Game logic

    private func begin() {
        roundStart = .now
        nextSpawn = .now
        score = 0
        cells = Array(repeating: LaserCell(), count: LaserConfig.cellCount)
        displayedTime = LaserConfig.totalDuration
        session.start()
        startTicker()
    }

    private func startTicker() {
        ticker?.invalidate()
        ticker = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { _ in
            Task { @MainActor in tick() }
        }
    }

    private func stopTicker() {
        ticker?.invalidate()
        ticker = nil
    }

    @MainActor
    private func tick() {
        let now = Date.now
        let elapsed = now.timeIntervalSince(roundStart)
        displayedTime = max(0, LaserConfig.totalDuration - elapsed)

        // Despawn expired lasers
        for i in 0..<cells.count {
            if let spawn = cells[i].spawnedAt, now.timeIntervalSince(spawn) > cells[i].dwell {
                cells[i] = LaserCell()
            }
        }

        // End of round
        if elapsed >= LaserConfig.totalDuration {
            stopTicker()
            session.submitLocalScore(score)
            return
        }

        // Spawn if scheduled
        if now >= nextSpawn {
            spawn(at: now, elapsed: elapsed)
            nextSpawn = now.addingTimeInterval(spawnInterval(at: elapsed))
        }
    }

    private func spawn(at now: Date, elapsed: TimeInterval) {
        let empties = (0..<cells.count).filter { cells[$0].spawnedAt == nil }
        guard let i = empties.randomElement() else { return }
        cells[i] = LaserCell(spawnedAt: now, dwell: dwell(at: elapsed))
    }

    private func tap(at i: Int) {
        guard cells[i].isActive else { return }
        score += 1
        cells[i] = LaserCell()
    }

    private func spawnInterval(at elapsed: TimeInterval) -> TimeInterval {
        let p = min(1.0, elapsed / LaserConfig.totalDuration)
        return LaserConfig.startSpawnInterval +
               (LaserConfig.endSpawnInterval - LaserConfig.startSpawnInterval) * p
    }

    private func dwell(at elapsed: TimeInterval) -> TimeInterval {
        let p = min(1.0, elapsed / LaserConfig.totalDuration)
        return LaserConfig.startDwell +
               (LaserConfig.endDwell - LaserConfig.startDwell) * p
    }
}

// MARK: - Cell views

private struct LaserCellView: View {
    let active: Bool

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.secondary.opacity(0.15))
            if active {
                LaserDot()
                    .transition(.scale.combined(with: .opacity))
            }
        }
        .animation(.easeOut(duration: 0.12), value: active)
    }
}

private struct LaserDot: View {
    @State private var pulse = false

    var body: some View {
        ZStack {
            Circle()
                .fill(.red.opacity(0.35))
                .scaleEffect(pulse ? 1.2 : 0.7)
            Circle()
                .fill(.red)
                .frame(width: 22, height: 22)
                .shadow(color: .red, radius: 6)
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 0.45).repeatForever(autoreverses: true)) {
                pulse = true
            }
        }
    }
}
