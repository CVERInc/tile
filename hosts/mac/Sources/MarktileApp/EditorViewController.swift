import AppKit
import WebKit

// The host side of the seam. Everything the person actually looks at is the shared engine running
// inside this web view; this class only carries text across and routes menu keys in.
final class EditorViewController: NSViewController, WKScriptMessageHandler, WKNavigationDelegate, NSMenuItemValidation {

    /// Fired whenever the editor's text changes. Carries the full document (files are small, and a
    /// full copy keeps the document's mirror trivially correct).
    var onChange: ((String) -> Void)?
    /// Where the document lives, asked at the moment it matters: a ⌘-click on `[[wikilink]]`
    /// resolves against the folder the file is in NOW, which Save As may have changed since the
    /// window opened. Nil for a document that was never saved.
    var documentURL: (() -> URL?)?

    private var webView: WKWebView!
    private var isReady = false
    /// Text handed to us before the page finished loading, replayed on `ready`.
    private var pendingText: String?

    // MARK: - View

    private var schemeHandler: BundleSchemeHandler?

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "marktile")
        // The editor is a local document, not a browser. Nothing here should be able to navigate
        // away or open a second window.
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        // The editor picks its language from navigator.language, which it only recognises for zh and ja.
        // Tell it the language the menus resolved to instead, so a Korean menu bar never sits above an
        // English editor, and a language the app has no menus for gets English in both places.
        config.userContentController.addUserScript(WKUserScript(
            source: "globalThis.__TILE_LOCALE = \(jsString(AppLanguage.engineLocale));",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))

        schemeHandler = BundleSchemeHandler(resourceRoot: EngineResources.resourceRoot())
        if let schemeHandler {
            config.setURLSchemeHandler(schemeHandler, forURLScheme: BundleSchemeHandler.scheme)
        }

        // A real frame, not .zero: NSWindow sizes itself from the content view controller's fitting
        // size, so a zero-frame web view produces a 1×1 window — the app shows up in the Dock and
        // nothing appears on screen.
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 760, height: 800), configuration: config)
        webView.navigationDelegate = self
        webView.setValue(false, forKey: "drawsBackground")   // let the window's material show through
        webView.allowsBackForwardNavigationGestures = false

        // NSWindow sizes a contentViewController from Auto Layout's fittingSize, and WKWebView has
        // no intrinsic content size — left alone it measures 0×0 and the window collapses to its
        // minimum. The fix is a preferred size the window can OVERRIDE: `preferredContentSize`
        // states it too, but as a fixed size, which quietly makes the window un-resizable. Two
        // low-priority constraints say "start this big, and give way the moment the person drags a
        // corner."
        let container = NSView(frame: NSRect(x: 0, y: 0, width: 760, height: 800))
        webView.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(webView)

        let width = webView.widthAnchor.constraint(equalToConstant: 760)
        let height = webView.heightAnchor.constraint(equalToConstant: 800)
        width.priority = .defaultLow
        height.priority = .defaultLow
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: container.topAnchor),
            webView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            width, height,
        ])
        view = container
    }

    // MARK: - System accent

    private var accentObservers: [Any] = []

    /// Mirrors the person's macOS accent colour into the page.
    ///
    /// No preference, no colour picker: they already chose one in System Settings, and an editor that
    /// asks again is an editor that can disagree with the rest of their Mac. `controlAccentColor` is
    /// resolved against the window's current appearance, so it is the light or dark variant as needed.
    private func pushAccent() {
        let appearance = view.effectiveAppearance
        var hex = "#007aff"
        appearance.performAsCurrentDrawingAppearance {
            if let srgb = NSColor.controlAccentColor.usingColorSpace(.sRGB) {
                hex = String(format: "#%02x%02x%02x",
                             Int((srgb.redComponent * 255).rounded()),
                             Int((srgb.greenComponent * 255).rounded()),
                             Int((srgb.blueComponent * 255).rounded()))
            }
        }
        webView.evaluateJavaScript("window.__mt && window.__mt.setAccent(\"\(hex)\")", completionHandler: nil)
    }

    private func observeAccent() {
        // Changing the accent in System Settings is a distributed notification, not an app-local one.
        accentObservers.append(
            DistributedNotificationCenter.default().addObserver(
                forName: NSNotification.Name("AppleColorPreferencesChangedNotification"),
                object: nil, queue: .main
            ) { [weak self] _ in self?.pushAccent() }
        )
        // Light/dark also changes which variant of the accent is correct.
        accentObservers.append(
            NSApp.observe(\.effectiveAppearance) { [weak self] _, _ in
                DispatchQueue.main.async { self?.pushAccent() }
            }
        )
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        observeAccent()
        guard schemeHandler != nil else { showMissingEngine(); return }
        let index = BundleSchemeHandler.baseURL.appendingPathComponent("Web/index.html")
        webView.load(URLRequest(url: index))
    }

    /// A broken install used to look like a blank window — the app was up, the menus worked, and
    /// nothing said why the page was empty. Say it on screen instead, in the one place the person
    /// is already looking.
    private func showMissingEngine() {
        webView.isHidden = true
        let label = NSTextField(wrappingLabelWithString: L(
            "marktile can’t find its editor engine.\n\nThe app is incomplete — reinstall it, or rebuild with scripts/build-app.sh."))
        label.alignment = .center
        label.textColor = .secondaryLabelColor
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            label.widthAnchor.constraint(lessThanOrEqualToConstant: 420),
        ])
    }

    // MARK: - Text in / out

    func load(text: String) {
        guard isReady else { pendingText = text; return }
        let js = "window.__mt.open(\(jsString(text)));"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    /// Pulls the editor's live text. Asynchronous by nature — WKWebView has no synchronous read.
    func currentText(_ completion: @escaping (String?) -> Void) {
        guard isReady else { completion(nil); return }
        webView.evaluateJavaScript("window.__mt.text()") { value, _ in
            completion(value as? String)
        }
    }

    // MARK: - Menu actions

    @objc func cycleMode(_ sender: Any?) {
        webView.evaluateJavaScript("window.__mt.cycleMode()", completionHandler: nil)
    }

    @objc func toggleToc(_ sender: Any?) {
        webView.evaluateJavaScript("window.__mt.toggleToc()", completionHandler: nil)
    }

    @objc func toggleLock(_ sender: Any?) {
        webView.evaluateJavaScript("window.__mt.toggleLock()", completionHandler: nil)
    }

    // MARK: - Text size

    /// A LADDER, not a multiplier. A text editor's sizes are a short list a person recognises — 16
    /// is the one they know as "normal" — and stepping by a factor lands on 17.6 and 19.36, which
    /// nobody asked for and which look like a rounding bug in a monospace canvas.
    /// The top of the ladder was 32 and that was a guess about how big anyone would want prose. It is
    /// wrong for the case this app is actually good at — a document open on a screen you are not
    /// sitting at, or reading with someone. The rungs widen past 32 because the difference between
    /// 40 and 44 is not a difference anybody reaches for; 48 is where a 1100px window still holds a
    /// sensible measure and past which this stops being an editor.
    private static let textSizes = [11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 40, 48]
    private static let defaultTextSize = 16
    private static let textSizeKey = "MarktileTextSize"

    /// App-wide, not per document: this is how big the person's eyes need the text, which does not
    /// change when they open a different file.
    static var textSize: Int {
        get {
            let v = UserDefaults.standard.integer(forKey: textSizeKey)
            return textSizes.contains(v) ? v : defaultTextSize
        }
        set { UserDefaults.standard.set(newValue, forKey: textSizeKey) }
    }

    private func stepTextSize(by delta: Int) {
        let sizes = Self.textSizes
        let i = sizes.firstIndex(of: Self.textSize) ?? sizes.firstIndex(of: Self.defaultTextSize)!
        Self.textSize = sizes[min(max(i + delta, 0), sizes.count - 1)]
        applyTextSize()
    }

    /// Push the size into the page. Also called after a load, so a new window opens at the size the
    /// person last chose rather than snapping back to 16 and making them set it again.
    func applyTextSize() {
        webView.evaluateJavaScript("window.__mt.setTextSize(\(Self.textSize))", completionHandler: nil)
    }

    // MARK: - Search every document (FlintfindKit)

    /// Always on. The engine is linked in (FlintfindKit, the library behind the `ff` command), so there
    /// is no tool to find and nothing the person installs separately. In the App Store build the same
    /// call reaches only what the app may read — Spotlight filters its own answer by the sandbox — so
    /// the first search asks for the home folder (FolderAccess.ensureSearchable), and a person who
    /// declines still gets their granted folders searched rather than a door that does nothing.
    private func pushCapabilities() {
        webView.evaluateJavaScript("window.__mt.setCapabilities({searchAll: true})", completionHandler: nil)
    }

    /// Run one search and hand the answer back to the page as it arrives (DocumentSearch). Off the
    /// main thread, because reading the unindexed folders on it would freeze the window.
    private func runSearch(id: Int, query: String) {
        // Terms split on whitespace, which is flintfind's own semantics: `ff a b` ANDs them.
        let terms = query.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        guard !terms.isEmpty else { return replySearch(id: id, json: "null") }
        // The panel can sit open for longer than the page's 25-second wait for an answer, which
        // would turn the search the person is about to allow into an empty result.
        let hold: () -> Void = { [weak self] in
            self?.webView.evaluateJavaScript("window.__mt.searchHold(\(id))", completionHandler: nil)
        }
        FolderAccess.shared.ensureSearchable(in: view.window, willAsk: hold) { [weak self] in
            DispatchQueue.global(qos: .userInitiated).async {
                DocumentSearch.run(terms) { json in
                    DispatchQueue.main.async { self?.replySearch(id: id, json: json) }
                }
            }
        }
    }

    // MARK: - Wikilinks

    /// ⌘-click on `[[name]]`. Resolution reads the disk — a vault can be thousands of files — so it
    /// runs off the main thread. Three answers, one per thing the person can do next: the file it
    /// means; a menu of the files it might mean; or the search panel with the name in it. See
    /// WikilinkResolver for why it stops short of guessing.
    ///
    /// In the App Store build the folder around the document may be invisible to the app; the first
    /// ⌘-click there asks for it once (FolderAccess). Declined, the link resolves against nothing and
    /// ends where a link to a note that does not exist ends: the search panel, with the name in it.
    private func openWikilink(_ target: String) {
        let document = documentURL?()
        guard let folder = document?.deletingLastPathComponent() else { return resolveWikilink(target, from: document) }
        FolderAccess.shared.ensureReadable(folder, in: view.window) { [weak self] _ in
            self?.resolveWikilink(target, from: document)
        }
    }

    private func resolveWikilink(_ target: String, from document: URL?) {
        DispatchQueue.global(qos: .userInitiated).async {
            let answer = WikilinkResolver.resolve(target: target, from: document)
            DispatchQueue.main.async {
                switch answer {
                case .file(let url):
                    self.openDocument(url)
                case .several(let urls, let vault):
                    self.chooseAmong(urls, vault: vault)
                case .none:
                    self.webView.evaluateJavaScript("window.__mt.searchFor(\(self.jsString(target)))", completionHandler: nil)
                }
            }
        }
    }

    private func openDocument(_ url: URL) {
        NSDocumentController.shared.openDocument(withContentsOf: url, display: true) { _, _, _ in }
    }

    /// Several notes share the name: a menu where the pointer is, one item per file, titled by its
    /// path inside the vault — the folder is the only thing that tells two same-named notes apart.
    /// A native menu rather than a panel in the page: "which of these did you mean" is what a Mac
    /// asks with a pop-up menu, and Escape or a click elsewhere dismisses it with nothing opened.
    private func chooseAmong(_ urls: [URL], vault: URL) {
        let menu = NSMenu()
        let root = vault.standardizedFileURL.path + "/"
        for url in urls {
            let full = url.standardizedFileURL.path
            let title = full.hasPrefix(root) ? String(full.dropFirst(root.count)) : url.lastPathComponent
            let item = NSMenuItem(title: title, action: #selector(openChosen(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = url
            menu.addItem(item)
        }
        // Where the pointer is now, which is where it was when the person clicked: resolution takes
        // tens of milliseconds, not long enough for the hand to have moved on.
        let inWindow = view.window?.mouseLocationOutsideOfEventStream ?? .zero
        menu.popUp(positioning: nil, at: webView.convert(inWindow, from: nil), in: webView)
    }

    @objc private func openChosen(_ sender: NSMenuItem) {
        if let url = sender.representedObject as? URL { openDocument(url) }
    }

    private func replySearch(id: Int, json: String) {
        // The payload is JSON built from the engine's answer, so it goes in as a STRING the page parses — never
        // spliced into the script as source, where a stray backtick would be code.
        let quoted = String(data: (try? JSONSerialization.data(withJSONObject: [json], options: []))
                            ?? Data("[\"null\"]".utf8), encoding: .utf8) ?? "[\"null\"]"
        webView.evaluateJavaScript("window.__mt.searchResult(\(id), \(quoted)[0])", completionHandler: nil)
    }

    @objc func textSizeUp(_ sender: Any?) { stepTextSize(by: 1) }
    @objc func textSizeDown(_ sender: Any?) { stepTextSize(by: -1) }
    @objc func textSizeReset(_ sender: Any?) { Self.textSize = Self.defaultTextSize; applyTextSize() }

    /// Every Format menu item, carrying the engine's own tool key in `representedObject`. One action
    /// for eleven items, because the menu has nothing to say about what "bold" means — it only has to
    /// name which button the person would otherwise have hunted for.
    @objc func runTool(_ sender: Any?) {
        guard let key = (sender as? NSMenuItem)?.representedObject as? String else { return }
        webView.evaluateJavaScript("window.__mt.tool(\(jsString(key)))", completionHandler: nil)
    }

    /// ⌘F. Opens the engine's own find bar rather than a native one: the search has to run over the
    /// text model the editor is holding, and a second search UI would be a second idea of what a match is.
    @objc func showFind(_ sender: Any?) {
        webView.evaluateJavaScript("window.__mt.find()", completionHandler: nil)
    }

    @objc func showSearchAll(_ sender: Any?) {
        webView.evaluateJavaScript("window.__mt.toggleSearchAll(true)", completionHandler: nil)
    }

    // Toolbar visibility is a preference, not per-document state: hiding it and having it return on the
    // next file would read as the app forgetting. Swift owns the value so every window agrees.
    private static let toolbarHiddenKey = "toolbarHidden"
    static var isToolbarHidden: Bool {
        get { UserDefaults.standard.bool(forKey: toolbarHiddenKey) }
        set { UserDefaults.standard.set(newValue, forKey: toolbarHiddenKey) }
    }

    @objc func toggleToolbar(_ sender: Any?) {
        Self.isToolbarHidden.toggle()
        for window in NSApp.windows {
            (window.contentViewController as? EditorViewController)?.pushToolbarVisibility()
        }
    }

    private func pushToolbarVisibility() {
        webView.evaluateJavaScript(
            "window.__mt && window.__mt.setToolbar(\(Self.isToolbarHidden ? "false" : "true"))",
            completionHandler: nil
        )
    }

    // NSMenuItemValidation, not an override — NSViewController doesn't declare it; the responder chain
    // finds it through the protocol.
    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        if item.action == #selector(toggleToolbar(_:)) {
            item.title = Self.isToolbarHidden ? L("Show Toolbar") : L("Hide Toolbar")
        }
        if item.action == #selector(toggleLock(_:)) {
            item.state = isLockedCache ? .on : .off
        }
        // Locked means read-only, and the engine already refuses these edits. Greying them out is the
        // difference between a menu that is honest about it and one that looks live and does nothing.
        if item.action == #selector(runTool(_:)) {
            return !isLockedCache
        }
        // At the ends of the ladder the item does nothing, so it says so. A ⌘+ that silently
        // no-ops reads as a bug in the shortcut rather than as "this is as big as it goes".
        if item.action == #selector(textSizeUp(_:)) { return Self.textSize != Self.textSizes.last }
        if item.action == #selector(textSizeDown(_:)) { return Self.textSize != Self.textSizes.first }
        if item.action == #selector(textSizeReset(_:)) { return Self.textSize != Self.defaultTextSize }
        return true
    }

    /// Menu validation is synchronous and reading the web view is not, so the lock state is mirrored
    /// here as the page reports it rather than guessed at validation time.
    private var isLockedCache = false

    // MARK: - Bridge

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let kind = body["kind"] as? String else { return }
        switch kind {
        case "lock":
            isLockedCache = (body["locked"] as? Bool) ?? false
        case "ready":
            isReady = true
            pushAccent()
            pushToolbarVisibility()
            applyTextSize()
            pushCapabilities()   // BEFORE the first open(): the engine decides at mount whether it has a scope control
            if let pending = pendingText {
                pendingText = nil
                load(text: pending)
            }
        case "openurl":
            // ⌘-click on a link (or a plain click in Rendered / when locked). Only http(s) and
            // mailto leave here: the page can ask for any string, and handing an arbitrary scheme to
            // NSWorkspace is how a document turns into a way to launch things. A relative or
            // unrecognised target is dropped rather than guessed at.
            if let raw = body["url"] as? String,
               let url = URL(string: raw),
               let scheme = url.scheme?.lowercased(),
               ["http", "https", "mailto"].contains(scheme) {
                NSWorkspace.shared.open(url)
            }
        case "search":
            if let id = body["id"] as? Int, let q = body["query"] as? String { runSearch(id: id, query: q) }
        case "openfile":
            // A search result. NSDocumentController opens it in its own window, which is what a
            // document app does with a second document — this one is not a vault browser.
            if let path = body["path"] as? String, FileManager.default.fileExists(atPath: path) {
                NSDocumentController.shared.openDocument(
                    withContentsOf: URL(fileURLWithPath: path), display: true) { _, _, _ in }
            }
        case "openwiki":
            if let target = body["target"] as? String { openWikilink(target) }
        case "change":
            if let text = body["text"] as? String { onChange?(text) }
        default:
            break
        }
    }

    // A local document app has exactly one page. Anything trying to navigate elsewhere — a stray
    // link click in the rendered view — goes to the person's browser instead of replacing the
    // editor with a web page they can't get back from.
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else { decisionHandler(.allow); return }
        if url.scheme == BundleSchemeHandler.scheme && navigationAction.navigationType == .other {
            decisionHandler(.allow)
        } else if navigationAction.navigationType == .linkActivated {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        } else {
            decisionHandler(.allow)
        }
    }

    // MARK: - Helpers

    /// JSON-encodes a Swift string into a JS literal. Hand-rolled escaping is how editors end up
    /// mangling a document that happens to contain a quote or a line separator.
    private func jsString(_ s: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: [s], options: []),
              let array = String(data: data, encoding: .utf8) else { return "\"\"" }
        return String(array.dropFirst().dropLast())   // ["…"] → "…"
    }
}
