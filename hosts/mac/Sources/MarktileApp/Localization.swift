import Foundation

// Every user-visible string in the Mac host goes through L().
//
// The tables live in hosts/mac/Localization/<lang>.lproj, and build-app.sh copies them into the app's
// own Contents/Resources — the MAIN bundle, not the SwiftPM resource bundle that carries the engine.
// Three reasons, all of them about what the system does, not what this code does:
//   • AppKit localizes the menu items it adds on its own (Services, Enter Full Screen, Open Recent ▸
//     Clear Menu, the save sheets, "Untitled") into whichever language the MAIN bundle resolves to.
//     Strings in any other bundle would give a translated File menu next to an English Services menu.
//   • The per-app language list in System Settings ▸ General ▸ Language & Region, and the App Store's
//     language list, are read from the main bundle's .lproj folders and CFBundleLocalizations.
//   • Bundle.module quietly falls back to .build/ on the machine that built it (see EngineResources).
//
// Keys are the English text, so a build that somehow lost its .lproj folders reads in English rather
// than in identifiers. scripts/check-l10n.py fails the build if any language is missing a key English
// has, if a key here has no English entry, or if a title reaches AppKit without passing through L().

func L(_ key: String) -> String {
    Bundle.main.localizedString(forKey: key, value: nil, table: nil)
}

func L(_ key: String, _ args: CVarArg...) -> String {
    String(format: L(key), arguments: args)
}

enum AppLanguage {
    /// The engine's own locale code (i18n/<code>.json) for the language the menus resolved to.
    /// Engine names are region-qualified; .lproj names are what macOS matches against the user's list.
    static var engineLocale: String {
        switch Bundle.main.preferredLocalizations.first {
        case "ja": return "ja-JP"
        case "ko": return "ko-KR"
        case "zh-Hant": return "zh-TW"
        default: return "en-US"
        }
    }
}
