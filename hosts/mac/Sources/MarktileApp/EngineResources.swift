import Foundation

// Where the app's Web/ and Engine/ actually live at runtime.
//
// Deliberately NOT `Bundle.module`. For an executable target SwiftPM generates that accessor as
// exactly two candidates — `Bundle.main.bundleURL/<name>.bundle`, and the absolute path of the
// .build directory that produced the binary — and then `fatalError`s when neither exists. Inside a
// real .app the resource bundle belongs in Contents/Resources/, which is the one place that
// accessor never looks. So the shipped app never matched the first candidate and spent its whole
// life reading its engine out of a developer's checkout; renaming that checkout killed it.
//
// There is no build-directory fallback here on purpose. An app that can borrow resources from the
// machine that built it is an app whose "it works" says nothing about anybody else's machine —
// and the failure it hides only surfaces somewhere nobody is watching.
enum EngineResources {

    static let bundleName = "MarktileMac_MarktileApp.bundle"

    /// Files the editor cannot come up without. A directory that exists proves nothing: the whole
    /// point of this check is that the previous one asked a question the app never asks.
    static let required = [
        "Web/index.html",
        "Web/bridge.js",
        "Engine/tile-core.js",
        "Engine/obsidian-shim.js",
        "Engine/host.js",
        "Engine/styles.css",
    ]

    /// Every place the bundle may legitimately sit, in the order the app should prefer them.
    static var candidates: [URL] {
        var out: [URL] = []
        var seen = Set<String>()
        func add(_ url: URL?) {
            guard let url else { return }
            let path = url.standardizedFileURL.path
            if seen.insert(path).inserted { out.append(url.standardizedFileURL) }
        }
        // Inside a .app: Contents/Resources/<name>.bundle — where macOS, and codesign, expect it.
        add(Bundle.main.resourceURL?.appendingPathComponent(bundleName))
        // `swift run`, or the binary run straight out of .build: the bundle sits beside it.
        add(Bundle.main.bundleURL.appendingPathComponent(bundleName))
        add(Bundle.main.executableURL?.deletingLastPathComponent().appendingPathComponent(bundleName))
        return out
    }

    /// The directory to serve over `marktile-app://`, or nil when the app is missing its engine.
    static func resourceRoot() -> URL? {
        candidates.first(where: isComplete)
    }

    static func isComplete(_ root: URL) -> Bool {
        missing(in: root).isEmpty
    }

    static func missing(in root: URL) -> [String] {
        required.filter { !FileManager.default.isReadableFile(atPath: root.appendingPathComponent($0).path) }
    }

    /// `MarktileApp --verify-resources` — runs the lookup above and reports what it found.
    ///
    /// This exists so the build script can stop asserting a path of its own choosing. The only
    /// check worth having is the one the app itself performs, run against the installed copy, at
    /// the install path: same binary, same location, same code.
    static func runVerification() -> Int32 {
        if let root = resourceRoot() {
            print("✓ engine resources: \(root.path)")
            return 0
        }
        FileHandle.standardError.write(Data("✗ marktile cannot find its engine. Tried:\n".utf8))
        for candidate in candidates {
            let why = FileManager.default.fileExists(atPath: candidate.path)
                ? "missing \(missing(in: candidate).joined(separator: ", "))"
                : "no such directory"
            FileHandle.standardError.write(Data("    \(candidate.path) — \(why)\n".utf8))
        }
        return 1
    }
}
