import AppKit
import WebKit

// marktile ▸ Settings… (⌘,). One window for the whole app, like every Mac app's settings.
//
// The page is Web/settings.html, drawn from the engine's own lists (EDITOR_TOOLS, EDITOR_MODES) with the
// engine's icons and words — the same picker the Obsidian plugin's settings tab draws. A native list
// would need a second copy of sixteen icons and their names, and the first time the toolbar gained a
// button the two would disagree. What Swift owns is the storage (EditorSettings) and the window.
final class SettingsWindowController: NSWindowController, WKScriptMessageHandler, NSWindowDelegate {

    static let shared = SettingsWindowController()

    private var webView: WKWebView!
    private var schemeHandler: BundleSchemeHandler?

    private init() {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 560, height: 820),
                              styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.title = L("Settings")
        window.minSize = NSSize(width: 420, height: 360)
        window.isReleasedWhenClosed = false
        window.setFrameAutosaveName("MarktileSettingsWindow")
        super.init(window: window)
        window.delegate = self

        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "marktile")
        config.userContentController.addUserScript(WKUserScript(
            source: "globalThis.__TILE_LOCALE = \"\(AppLanguage.engineLocale)\";",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        schemeHandler = BundleSchemeHandler(resourceRoot: EngineResources.resourceRoot())
        if let schemeHandler { config.setURLSchemeHandler(schemeHandler, forURLScheme: BundleSchemeHandler.scheme) }
        webView = WKWebView(frame: window.contentLayoutRect, configuration: config)
        webView.setValue(false, forKey: "drawsBackground")
        webView.autoresizingMask = [.width, .height]
        window.contentView = webView
        webView.load(URLRequest(url: BundleSchemeHandler.baseURL.appendingPathComponent("Web/settings.html")))
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    func show() {
        if window?.isVisible != true { window?.center() }
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let kind = body["kind"] as? String else { return }
        switch kind {
        case "ready":
            webView.evaluateJavaScript("window.__settings.load(\(EditorSettings.json))", completionHandler: nil)
        case "save":
            if let json = body["json"] as? String { EditorSettings.save(json) }
        default:
            break
        }
    }
}
