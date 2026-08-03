import AppKit

// One .md file, one window.
//
// Two fidelity rules this class exists to enforce, both of the same shape — *opening a file and
// saving it unchanged must produce a byte-identical file*. Anything else means a git diff full of
// changes the person never made:
//
//   1. Read the text back with ctrl.rawValue(), never ctrl.getValue() — getValue() strips trailing
//      whitespace, which is right for a kanban card and wrong for a file.
//   2. Line endings survive. The editor works in LF; a CRLF file is converted on the way in and
//      converted back on the way out.
// @objc pins the Objective-C class name. Info.plist's NSDocumentClass looks the document class up by
// string; without this it would be the mangled "MarktileApp.MarkdownDocument" and double-clicking a
// .md would open nothing, with no error anywhere.
@objc(MarkdownDocument)
final class MarkdownDocument: NSDocument {

    /// The document text, in LF. Kept in sync from the editor's onChange so that
    /// `data(ofType:)` — which AppKit calls synchronously — never has to reach into the
    /// (asynchronous) web view.
    private var text: String = ""

    /// What the file used on disk, so we can hand it back the way we found it.
    private enum LineEnding { case lf, crlf }
    private var lineEnding: LineEnding = .lf

    private weak var editor: EditorViewController?

    // Autosave-in-place is deliberately off. It would mean writing to the person's file on a timer
    // — including into a git working tree — without them asking. ⌘S is the whole contract.
    override class var autosavesInPlace: Bool { false }

    // MARK: - Window

    override func makeWindowControllers() {
        let vc = EditorViewController()
        vc.onChange = { [weak self] newText in
            guard let self else { return }
            guard newText != self.text else { return }
            self.text = newText
            self.updateChangeCount(.changeDone)
        }

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 760, height: 800),
            // A plain title bar, not .fullSizeContentView. The transparent-titlebar look costs the
            // page a hard-coded top inset, and that inset is wrong the moment macOS adds a tab bar
            // — which is how the toolbar ended up sliced in half behind the tabs.
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.contentViewController = vc
        window.minSize = NSSize(width: 420, height: 320)
        // .automatic follows the person's "Prefer tabs when opening documents" setting.
        // .preferred overrides it and forces every document into the front window's tab bar,
        // which is not the app's call to make.
        window.tabbingMode = .automatic
        window.tabbingIdentifier = "marktile.document"
        Self.applyFrame(to: window)

        let wc = NSWindowController(window: window)
        wc.shouldCascadeWindows = true
        addWindowController(wc)

        editor = vc
        vc.load(text: text)
    }

    // MARK: - Window frame

    private static let autosaveName = "MarktileDocumentWindow"
    private static let defaultSize = NSSize(width: 760, height: 800)

    /// Restores the remembered window frame, but never trusts it blindly.
    ///
    /// A saved frame is persistent state the app writes about itself, so a frame that was wrong
    /// once stays wrong forever — restored on launch, saved again on quit. (That is exactly how a
    /// 1×1 window survived a build that had already fixed the cause.) Anything too small to work in
    /// is discarded rather than shown; a window nobody can see is worse than a forgotten position.
    private static func applyFrame(to window: NSWindow) {
        let restored = window.setFrameUsingName(NSWindow.FrameAutosaveName(autosaveName))
        let usable = window.frame.width >= 480 && window.frame.height >= 400
        if !restored || !usable {
            window.setContentSize(defaultSize)
            window.center()
        }
        window.setFrameAutosaveName(NSWindow.FrameAutosaveName(autosaveName))
    }

    // MARK: - Reading

    override func read(from data: Data, ofType typeName: String) throws {
        // UTF-8 only, and it says so out loud. A markdown editor that silently guesses at legacy
        // encodings and guesses wrong corrupts the file on the next save; refusing is the honest
        // failure. (This is the one place where "open anything" is NOT the goal.)
        guard let raw = String(data: data, encoding: .utf8) else {
            throw NSError(domain: "net.cver.marktile", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "This file isn’t UTF-8 text.",
                NSLocalizedRecoverySuggestionErrorKey:
                    "marktile reads and writes UTF-8. Convert the file first, or open it in an editor that can re-encode it.",
            ])
        }
        lineEnding = raw.contains("\r\n") ? .crlf : .lf
        text = (lineEnding == .crlf) ? raw.replacingOccurrences(of: "\r\n", with: "\n") : raw
        editor?.load(text: text)
    }

    // MARK: - Writing

    override func data(ofType typeName: String) throws -> Data {
        let out = (lineEnding == .crlf) ? text.replacingOccurrences(of: "\n", with: "\r\n") : text
        guard let data = out.data(using: .utf8) else {
            throw NSError(domain: "net.cver.marktile", code: 2, userInfo: [
                NSLocalizedDescriptionKey: "Couldn’t encode this document as UTF-8.",
            ])
        }
        return data
    }

    // The editor coalesces its change notifications (~140 ms), so the last few keystrokes before
    // ⌘S may not have reached `text` yet. Pull the live value first, then let AppKit run the normal
    // save. Without this, "type, ⌘S, ⌘Q" can lose the final word.
    override func save(
        to url: URL,
        ofType typeName: String,
        for saveOperation: NSDocument.SaveOperationType,
        completionHandler: @escaping (Error?) -> Void
    ) {
        guard let editor else {
            superSave(to: url, ofType: typeName, for: saveOperation, completionHandler: completionHandler)
            return
        }
        editor.currentText { [weak self] latest in
            if let latest { self?.text = latest }
            self?.superSave(to: url, ofType: typeName, for: saveOperation, completionHandler: completionHandler)
        }
    }

    // `super` can't be captured by an escaping closure, so the async path hops through here.
    private func superSave(
        to url: URL,
        ofType typeName: String,
        for saveOperation: NSDocument.SaveOperationType,
        completionHandler: @escaping (Error?) -> Void
    ) {
        super.save(to: url, ofType: typeName, for: saveOperation, completionHandler: completionHandler)
    }

    // MARK: - Revert

    override func revert(toContentsOf url: URL, ofType typeName: String) throws {
        try super.revert(toContentsOf: url, ofType: typeName)
        editor?.load(text: text)
    }
}
