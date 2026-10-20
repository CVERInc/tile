import AppKit

// Answered before AppKit is touched, so the build script can ask the shipped binary the one
// question that matters — "can you find your own engine, from where you are installed?" — without
// a window, a Dock icon, or a run loop.
if CommandLine.arguments.contains("--verify-resources") {
    exit(EngineResources.runVerification())
}
// Same shape, second question: is the sandbox in the signature the sandbox in force? Reading the
// entitlements cannot answer that; only the running process can (see FolderAccess.swift).
if CommandLine.arguments.contains("--report-sandbox") {
    exit(FolderAccess.runReport())
}
// Third: which language did the menus resolve to, and what do they say? Builds the real menu bar and
// prints it, so a translation can be checked from the shipped bundle over ssh — `-AppleLanguages
// '(ja)'` picks the language. AppKit's own additions (Services, Enter Full Screen) appear only in a
// running app and are not in this list.
if CommandLine.arguments.contains("--dump-menu") {
    func dump(_ menu: NSMenu, _ depth: Int) {
        for item in menu.items where !item.isSeparatorItem {
            var key = ""
            if !item.keyEquivalent.isEmpty {
                let m = item.keyEquivalentModifierMask
                key = "  " + (m.contains(.control) ? "⌃" : "") + (m.contains(.option) ? "⌥" : "")
                    + (m.contains(.shift) ? "⇧" : "") + (m.contains(.command) ? "⌘" : "") + item.keyEquivalent
            }
            // A top-level item carries its name on its submenu (the app menu has none: macOS shows the app's name).
            let title = item.submenu.map { $0.title.isEmpty ? "(app menu)" : $0.title } ?? item.title
            print(String(repeating: "  ", count: depth) + title + key)
            if let sub = item.submenu { dump(sub, depth + 1) }
        }
    }
    _ = NSApplication.shared   // makeMainMenu() hands the Window menu to NSApp
    print("menus: \(Bundle.main.preferredLocalizations.first ?? "?"), editor: \(AppLanguage.engineLocale)")
    dump(makeMainMenu(), 0)
    exit(0)
}

// No Xcode, no NIB — the app is assembled in code (see scripts/build-app.sh).
//
// NSDocumentController must exist before the run loop starts: the File menu's New/Open reach
// it through the responder chain, and a document app with no controller silently does nothing
// when you press ⌘O. Touching `.shared` is what creates it.
_ = NSDocumentController.shared

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.mainMenu = makeMainMenu()
app.run()
