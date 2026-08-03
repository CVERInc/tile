import Foundation
import WebKit
import UniformTypeIdentifiers

// Serves the app bundle's Web/ and Engine/ over a private scheme.
//
// Why not just loadFileURL? Because the editor is an ES module, and a page loaded from file:// has
// an opaque ("null") origin — every `import` is then blocked by CORS, in WKWebView exactly as in a
// browser, and the window comes up blank with the failure buried in a web console nobody sees.
// A custom scheme gives the page a real origin, so modules resolve. It is public API (macOS 10.13+)
// and sandbox-safe, which keeps the Mac App Store door open.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {

    static let scheme = "marktile-app"
    static let baseURL = URL(string: "\(scheme)://bundle/")!

    private let root: URL

    init?(resourceRoot: URL?) {
        guard let resourceRoot else { return nil }
        // Resolve once so the traversal check below compares real paths, not symlinked ones.
        root = resourceRoot.resolvingSymlinksInPath()
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else {
            task.didFailWithError(URLError(.badURL))
            return
        }

        // "marktile-app://bundle/Web/index.html" → <resources>/Web/index.html
        let relative = url.path.hasPrefix("/") ? String(url.path.dropFirst()) : url.path
        let target = root.appendingPathComponent(relative).standardizedFileURL.resolvingSymlinksInPath()

        // Nothing outside the bundle is reachable, whatever the page asks for.
        guard target.path == root.path || target.path.hasPrefix(root.path + "/"),
              let data = try? Data(contentsOf: target) else {
            task.didFailWithError(URLError(.fileDoesNotExist))
            return
        }

        let response = URLResponse(
            url: url,
            mimeType: Self.mimeType(for: target),
            expectedContentLength: data.count,
            textEncodingName: "utf-8"
        )
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        // Every response above is delivered synchronously, so there is nothing in flight to cancel.
    }

    private static func mimeType(for url: URL) -> String {
        switch url.pathExtension.lowercased() {
        // Spelled out rather than asked of UTType: a wrong or missing JS type makes WebKit refuse
        // the module with a strict-MIME error, which looks exactly like the CORS failure this
        // handler exists to avoid.
        case "js", "mjs":  return "text/javascript"
        case "html", "htm": return "text/html"
        case "css":        return "text/css"
        case "json":       return "application/json"
        case "svg":        return "image/svg+xml"
        default:
            return UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        }
    }
}
