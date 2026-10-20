import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    // Launching with no file opens one empty document — the plain "I want to write something"
    // path. Double-clicking a .md in Finder goes through NSDocumentController instead and never
    // reaches here.
    func applicationShouldOpenUntitledFile(_ sender: NSApplication) -> Bool { true }

    // A document app whose last window closed is still alive (⌘O should work from the menu bar),
    // which is what every other macOS editor does.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    // Folder grants (App Store build only) are resolved before AppKit restores last session's
    // windows, so a note that was reached through a grant can be reopened.
    func applicationWillFinishLaunching(_ notification: Notification) {
        FolderAccess.shared.restore()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.activate(ignoringOtherApps: false)
    }
}
