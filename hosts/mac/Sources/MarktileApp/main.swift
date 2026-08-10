import AppKit

// Answered before AppKit is touched, so the build script can ask the shipped binary the one
// question that matters — "can you find your own engine, from where you are installed?" — without
// a window, a Dock icon, or a run loop.
if CommandLine.arguments.contains("--verify-resources") {
    exit(EngineResources.runVerification())
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
