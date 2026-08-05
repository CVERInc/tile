import AppKit
import WebKit

// The host side of the seam. Everything the person actually looks at is the shared engine running
// inside this web view; this class only carries text across and routes menu keys in.
final class EditorViewController: NSViewController, WKScriptMessageHandler, WKNavigationDelegate, NSMenuItemValidation {

    /// Fired whenever the editor's text changes. Carries the full document (files are small, and a
    /// full copy keeps the document's mirror trivially correct).
    var onChange: ((String) -> Void)?

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

        schemeHandler = BundleSchemeHandler(resourceRoot: Bundle.module.resourceURL)
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
        guard schemeHandler != nil else { return }
        let index = BundleSchemeHandler.baseURL.appendingPathComponent("Web/index.html")
        webView.load(URLRequest(url: index))
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
    private static let textSizes = [11, 12, 13, 14, 16, 18, 20, 24, 28, 32]
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
            item.title = Self.isToolbarHidden ? "Show Toolbar" : "Hide Toolbar"
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
            if let pending = pendingText {
                pendingText = nil
                load(text: pending)
            }
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
