import AppKit

// Which folders this app may read beyond the one document it was handed — and, in the App Store
// build, asking for one.
//
// The two builds are ONE binary. What differs is the entitlements it is signed with
// (`entitlements/direct.entitlements`, `entitlements/appstore.entitlements`), and the code asks the
// running process whether a sandbox actually applied rather than reading a compile-time label. A
// label can disagree with the signature — an "appstore" build signed without the sandbox, or the
// direct build re-signed with it to test — and then the app would ask for folders it can already
// read, or skip asking for folders it cannot. The environment variable below is set by the sandbox
// itself as it initialises the process, so it describes what happened, not what was intended.
//
// Outside the sandbox every folder is readable and nothing here ever shows a panel.
// Inside it, a document opened from Finder or ⌘O grants exactly that one file. A `[[wikilink]]`
// needs the folder around it, so the first ⌘-click in a folder nobody has granted asks once with
// an open panel pointed at that folder, and the answer is kept as a security-scoped bookmark that
// is resolved again on every launch.
final class FolderAccess {

    static let shared = FolderAccess()

    /// True when the App Sandbox is in force for this process.
    static let isSandboxed: Bool =
        ProcessInfo.processInfo.environment["APP_SANDBOX_CONTAINER_ID"] != nil

    /// The person's real home folder. Inside the sandbox `NSHomeDirectory()` and
    /// `FileManager.homeDirectoryForCurrentUser` both answer with the app's container
    /// (~/Library/Containers/<id>/Data), which is the wrong answer to "is this folder their home?".
    static let realHome: URL = {
        if let pw = getpwuid(getuid()), let dir = pw.pointee.pw_dir {
            return URL(fileURLWithPath: String(cString: dir), isDirectory: true).standardizedFileURL
        }
        return FileManager.default.homeDirectoryForCurrentUser.standardizedFileURL
    }()

    private static let defaultsKey = "MarktileFolderGrants"

    /// Folders currently open to this process through a security-scoped bookmark. Access is started
    /// once and held for the life of the app: a note opened through a grant has to stay saveable for
    /// as long as its window is open, and there is no point at which that is known to be over.
    private var granted: [URL] = []

    /// Folders the person was asked about and declined, this launch only. One panel per folder per
    /// launch — a second ⌘-click after Cancel beeps instead of asking again.
    private var declined = Set<String>()

    private var panelOpen = false

    /// Resolve every saved grant. Called before AppKit restores windows, so a document that was
    /// reached through a grant last time can be reopened this time.
    func restore() {
        guard Self.isSandboxed else { return }
        let saved = UserDefaults.standard.array(forKey: Self.defaultsKey) as? [Data] ?? []
        var kept: [Data] = []
        for data in saved {
            var stale = false
            guard let url = try? URL(resolvingBookmarkData: data, options: [.withSecurityScope],
                                     relativeTo: nil, bookmarkDataIsStale: &stale),
                  url.startAccessingSecurityScopedResource() else { continue }  // folder gone: forget it
            granted.append(url.standardizedFileURL)
            // A stale bookmark still resolved, but the next launch may not manage it; write a fresh one.
            if stale, let fresh = try? url.bookmarkData(options: [.withSecurityScope],
                                                        includingResourceValuesForKeys: nil,
                                                        relativeTo: nil) {
                kept.append(fresh)
            } else {
                kept.append(data)
            }
        }
        UserDefaults.standard.set(kept, forKey: Self.defaultsKey)
    }

    /// Calls `then` once the app can read `folder` — at once when it already can, after the panel
    /// when it has to ask, or with `false` when the person said no. Main thread only.
    func ensureReadable(_ folder: URL, in window: NSWindow?, then: @escaping (Bool) -> Void) {
        let folder = folder.standardizedFileURL
        guard Self.isSandboxed, !canList(folder) else { return then(true) }
        guard !declined.contains(folder.path), !panelOpen else { return then(false) }

        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        panel.directoryURL = folder
        panel.prompt = "Allow"
        panel.message = "To follow links to other notes, marktile needs to read the folder this note is in. "
            + "If the note is inside an Obsidian vault, choose the vault’s folder so links anywhere in it work."
        panelOpen = true
        let finish: (NSApplication.ModalResponse) -> Void = { [weak self] response in
            guard let self else { return }
            self.panelOpen = false
            guard response == .OK, let picked = panel.url else {
                self.declined.insert(folder.path)
                return then(false)
            }
            self.grant(picked)
            then(self.canList(folder))
        }
        if let window { panel.beginSheetModal(for: window, completionHandler: finish) }
        else { finish(panel.runModal()) }
    }

    private func grant(_ url: URL) {
        let url = url.standardizedFileURL
        guard let data = try? url.bookmarkData(options: [.withSecurityScope],
                                               includingResourceValuesForKeys: nil, relativeTo: nil)
        else { return }
        // The URL the panel returns is readable until the app quits; the bookmark is what makes it
        // readable on the next launch. Start scoped access anyway so both cases go through one path.
        _ = url.startAccessingSecurityScopedResource()
        granted.append(url)
        var saved = UserDefaults.standard.array(forKey: Self.defaultsKey) as? [Data] ?? []
        saved.append(data)
        UserDefaults.standard.set(saved, forKey: Self.defaultsKey)
    }

    /// Asks the file system rather than the list of grants: the folder may be readable for a reason
    /// this class did not record (a panel this launch, or a grant covering a parent).
    private func canList(_ folder: URL) -> Bool {
        (try? FileManager.default.contentsOfDirectory(atPath: folder.path)) != nil
    }

    /// `--report-sandbox`: what the running process can see, printed without opening a window — so
    /// the build script and a person over ssh can check that the sandbox in the signature is the
    /// sandbox in force, which reading the entitlements alone cannot show.
    static func runReport() -> Int32 {
        let env = ProcessInfo.processInfo.environment
        print("sandboxed: \(isSandboxed ? "yes" : "no")")
        if let id = env["APP_SANDBOX_CONTAINER_ID"] { print("container: \(id)") }
        print("NSHomeDirectory: \(NSHomeDirectory())")
        // The real home folder: every account has one, privacy settings do not guard it (so a denial
        // here is the sandbox, not TCC), and no sandboxed app may list it without a grant.
        let readable = (try? FileManager.default.contentsOfDirectory(atPath: realHome.path)) != nil
        print("list \(realHome.path): \(readable ? "allowed" : "denied")")
        return 0
    }
}
