import AppKit

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
