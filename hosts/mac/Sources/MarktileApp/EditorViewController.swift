import AppKit
import WebKit

// The host side of the seam. Everything the person actually looks at is the shared engine running
// inside this web view; this class only carries text across and routes menu keys in.
final class EditorViewController: NSViewController, WKScriptMessageHandler, WKNavigationDelegate {

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

    override func viewDidLoad() {
        super.viewDidLoad()
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

    // MARK: - Bridge

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let kind = body["kind"] as? String else { return }
        switch kind {
        case "ready":
            isReady = true
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
