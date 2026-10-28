import Foundation
import Testing
@testable import AIMemoryMenuCore

struct DataDirTokenTests {
    private func makeDataDir() throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appending(path: "ai-memory-menu-token-\(UUID().uuidString)")
        try FileManager.default.createDirectory(
            at: dir.appending(path: "auth-tokens"),
            withIntermediateDirectories: true
        )
        return dir
    }

    @Test func readsTheTokenInitWroteAndTrimsIt() throws {
        let dir = try makeDataDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        try Data("aim-root-test-token\n".utf8).write(to: DataDirToken.path(dataDir: dir))

        #expect(DataDirToken.read(dataDir: dir) == "aim-root-test-token")
        #expect(DataDirToken.effective(saved: nil, dataDir: dir) == "aim-root-test-token")
        #expect(DataDirToken.effective(saved: "", dataDir: dir) == "aim-root-test-token")
    }

    @Test func aSavedTokenWinsOverTheFile() throws {
        let dir = try makeDataDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        try Data("from-file".utf8).write(to: DataDirToken.path(dataDir: dir))

        #expect(DataDirToken.effective(saved: "from-keychain", dataDir: dir) == "from-keychain")
    }

    @Test func aMissingOrBlankFileGivesNoToken() throws {
        let dir = try makeDataDir()
        defer { try? FileManager.default.removeItem(at: dir) }

        #expect(DataDirToken.read(dataDir: dir) == nil)
        try Data("  \n".utf8).write(to: DataDirToken.path(dataDir: dir))
        #expect(DataDirToken.read(dataDir: dir) == nil)
        #expect(DataDirToken.effective(saved: nil, dataDir: dir) == nil)
    }
}
