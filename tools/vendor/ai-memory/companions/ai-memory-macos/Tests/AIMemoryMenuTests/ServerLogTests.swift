import Foundation
import Testing
@testable import AIMemoryMenuCore

struct ServerLogTests {
    @Test func extractsTheTrailingErrorBlock() {
        let log = """
        2026-10-02T02:20:53Z  INFO ai_memory_cli: ai-memory starting version="2.5.2"
        2026-10-02T02:20:53Z  INFO ai_memory_cli::commands::serve: MCP Streamable HTTP transport mode stateful=false
        Error: binding 127.0.0.1:49374

        Caused by:
            Address already in use (os error 48)
        """
        let error = ServerLog.extractError(from: log)
        #expect(error?.hasPrefix("Error: binding 127.0.0.1:49374") == true)
        #expect(error?.contains("Address already in use") == true)
    }

    @Test func keepsOnlyTheLastError() {
        let log = """
        Error: binding 127.0.0.1:49374

        Error: could not open store
        """
        #expect(ServerLog.extractError(from: log) == "Error: could not open store")
    }

    @Test func returnsNilWhenNoErrorIsLogged() {
        #expect(ServerLog.extractError(from: "just some INFO lines\n") == nil)
    }

    @Test func readsOnlyTheTailOfTheFile() throws {
        let dir = FileManager.default.temporaryDirectory
            .appending(path: "aimem-log-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let logURL = dir.appending(path: "stderr.log")
        let filler = String(repeating: "x", count: 100_000)
        try (filler + "\nError: binding 127.0.0.1:49374\n")
            .write(to: logURL, atomically: true, encoding: .utf8)

        let error = ServerLog.recentError(at: logURL, maxBytes: 4096)
        #expect(error?.contains("binding 127.0.0.1:49374") == true)
    }

    @Test func returnsNilForAMissingFile() {
        #expect(ServerLog.recentError(at: URL(fileURLWithPath: "/nonexistent/stderr.log")) == nil)
    }
}

struct StartFailureTests {
    @Test func prefersTheLoggedErrorOverTheHealthError() throws {
        let logURL = try makeLog("""
        Error: binding 127.0.0.1:49374

        Caused by:
            Address already in use (os error 48)
        """)
        let message = StartFailure.message(
            health: "Could not read /admin/status",
            launchd: .stopped,
            logURL: logURL,
            notBefore: .distantPast
        )
        #expect(message.contains("Address already in use"))
    }

    @Test func ignoresAnErrorLoggedBeforeTheLastStart() throws {
        let logURL = try makeLog("Error: binding 127.0.0.1:49374\n")
        try FileManager.default.setAttributes(
            [.modificationDate: Date().addingTimeInterval(-3600)],
            ofItemAtPath: logURL.path
        )
        let message = StartFailure.message(
            health: "Could not read /admin/status",
            launchd: .stopped,
            logURL: logURL,
            notBefore: Date()
        )
        #expect(message == "Could not read /admin/status")
    }

    @Test func fallsBackToHealthWhenNotInstalled() {
        let message = StartFailure.message(
            health: "Connection refused",
            launchd: .notInstalled,
            logURL: URL(fileURLWithPath: "/nonexistent/stderr.log"),
            notBefore: .distantPast
        )
        #expect(message == "Connection refused")
    }

    @Test func fallsBackToHealthWhileRunning() throws {
        let logURL = try makeLog("Error: binding 127.0.0.1:49374\n")
        let message = StartFailure.message(
            health: "Could not read /admin/status",
            launchd: .running,
            logURL: logURL,
            notBefore: .distantPast
        )
        #expect(message == "Could not read /admin/status")
    }

    private func makeLog(_ contents: String) throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appending(path: "aimem-start-failure-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let logURL = dir.appending(path: "stderr.log")
        try contents.write(to: logURL, atomically: true, encoding: .utf8)
        return logURL
    }
}
