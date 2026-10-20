import Foundation

// The editor's own preferences — which toolbar buttons, which modes — kept in exactly the shape the
// Obsidian plugin keeps them (`editorTools`, `modes`: a missing key means on). The engine reads that one
// contract on every surface, so a preference means the same thing in Obsidian and here, and the page
// that edits it (Web/settings.html) is the same picker the plugin's settings tab draws.
//
// Stored as the JSON object itself rather than as separate defaults: Swift never interprets it, it only
// carries it from the settings page to every editor page, so a key the engine grows later needs no
// change here.
enum EditorSettings {
    static let didChange = Notification.Name("MarktileEditorSettingsDidChange")
    private static let key = "MarktileEditorSettings"

    /// The stored object as JSON — `{}` when nothing has been chosen, which means every default.
    static var json: String {
        guard let s = UserDefaults.standard.string(forKey: key), isObject(s) else { return "{}" }
        return s
    }

    /// Store a new object and tell every open window. Anything that is not a JSON object is refused:
    /// the string arrives from a web page, and the next launch would hand it to every editor.
    static func save(_ s: String) {
        guard isObject(s) else { return }
        UserDefaults.standard.set(s, forKey: key)
        NotificationCenter.default.post(name: didChange, object: nil)
    }

    private static func isObject(_ s: String) -> Bool {
        (try? JSONSerialization.jsonObject(with: Data(s.utf8))) is [String: Any]
    }
}
