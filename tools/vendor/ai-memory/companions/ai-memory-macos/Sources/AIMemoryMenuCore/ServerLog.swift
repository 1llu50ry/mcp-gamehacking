import Foundation

/// Reads the tail of the bundled server's log so the menu extra can show why
/// the LaunchAgent exited instead of only a red status item.
public enum ServerLog {
    /// `maxBytes` bounds the read so an unbounded log cannot be pulled into
    /// memory just to show one message.
    public static func recentError(at url: URL, maxBytes: Int = 64 * 1024) -> String? {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? handle.close() }
        let size = (try? handle.seekToEnd()) ?? 0
        let offset = size > UInt64(maxBytes) ? size - UInt64(maxBytes) : 0
        try? handle.seek(toOffset: offset)
        guard let data = try? handle.readToEnd() else { return nil }
        // The tail can start mid-scalar; lossy decoding keeps the visible text.
        return extractError(from: String(decoding: data, as: UTF8.self))
    }

    static func extractError(from log: String) -> String? {
        let lines = log.components(separatedBy: "\n")
        guard let start = lines.lastIndex(where: { $0.hasPrefix("Error:") }) else {
            return nil
        }
        let block = lines[start...]
            .joined(separator: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return block.isEmpty ? nil : block
    }
}

/// Picks the message the menu extra shows when the server is unreachable.
public enum StartFailure {
    /// Only when the agent is installed but stopped, and only from a log
    /// written since `notBefore` (app launch or the last start): `stderr.log`
    /// is append-only and a manual stop also reads as `.stopped`, so an error
    /// left over from an earlier attempt must not be misreported.
    public static func message(
        health: String,
        launchd: LaunchdState,
        logURL: URL,
        notBefore: Date
    ) -> String {
        guard launchd == .stopped,
              let modified = modificationDate(of: logURL),
              modified >= notBefore,
              let logged = ServerLog.recentError(at: logURL)
        else { return health }
        return logged
    }

    private static func modificationDate(of url: URL) -> Date? {
        let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
        return attributes?[.modificationDate] as? Date
    }
}
