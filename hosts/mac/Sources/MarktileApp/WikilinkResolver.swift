import Foundation

// Which file on this machine a `[[wikilink]]` means — answered without guessing.
//
// Obsidian can answer this because it owns a vault and an index of every name in it. This app owns
// one document, so it answers only what a file NAME can settle, and hands everything else to the
// person:
//
//   1. `name.md` beside the document. Most links in a notes folder are to a sibling, and a flat
//      folder of notes (a memory directory, say) is settled entirely by this step.
//   2. Inside the enclosing Obsidian vault — the nearest folder above the document that holds
//      `.obsidian` — a file with exactly that name, IF there is exactly one. Two notes called the
//      same thing is precisely the case where opening either would be guessing.
//   3. Anything else — no vault, no match, more than one match — is not resolved here. The caller
//      opens the search panel with the name already typed, so the person picks.
//
// A link to a note that does not exist does NOT create one, which is what Obsidian does. Ruled
// 2026-10-14: KITT proposed it, chodaict answered 「同意，多謝！」. The reason is the same as the
// app's whole scope — it opens one document and is not a vault's caretaker, so a ⌘-click that quietly
// wrote an empty file into whatever folder the document sits in would litter places nobody chose.
enum WikilinkResolver {

    /// Pure apart from reading the file system, so it can be exercised against a temporary folder.
    /// `target` is the link with any `|alias` and `#heading` already removed by the engine.
    static func resolve(target raw: String, from document: URL?, fileManager fm: FileManager = .default) -> URL? {
        let target = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let document, !target.isEmpty else { return nil }
        // The string comes out of the document, and the document can say anything. A link is a NAME
        // inside the folder or vault it lives in; `..` or a leading `/` would make it an address
        // anywhere on the disk, and nothing a note can legitimately mean needs that.
        let parts = target.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        guard !target.hasPrefix("/"), !target.hasPrefix("~"),
              !parts.contains(where: { $0 == ".." || $0 == "." || $0.isEmpty }) else { return nil }

        let relative = target.lowercased().hasSuffix(".md") ? target : target + ".md"
        let folder = document.deletingLastPathComponent()

        // 1. Beside the document. APFS compares names case- and normalization-insensitively by
        //    default, so `fileExists` already agrees with how Obsidian treats `[[Note]]` vs note.md.
        let sibling = folder.appendingPathComponent(relative)
        if isFile(sibling, fm) { return asOnDisk(sibling, fm) }

        // 2. The vault, if there is one.
        guard let vault = enclosingVault(of: folder, fm) else { return nil }
        // A link with a slash is a path from the vault's root — `[[Business/plan]]` — which is how
        // Obsidian writes one when the bare name alone would be ambiguous.
        if parts.count > 1 {
            let rooted = vault.appendingPathComponent(relative)
            return isFile(rooted, fm) ? asOnDisk(rooted, fm) : nil
        }
        return uniqueMatch(named: relative, under: vault, fm)
    }

    /// The nearest folder at or above `folder` that holds `.obsidian`. Stops below the home folder
    /// and the disk's root: a `.obsidian` there would make "the vault" every file the person owns.
    /// (A vault on an external disk is still found — it sits under /Volumes, not under home.)
    static func enclosingVault(of folder: URL, _ fm: FileManager) -> URL? {
        let home = fm.homeDirectoryForCurrentUser.standardizedFileURL.path
        var dir = folder.standardized
        while dir.path != "/" && dir.path != home {
            var isDir: ObjCBool = false
            if fm.fileExists(atPath: dir.appendingPathComponent(".obsidian").path, isDirectory: &isDir), isDir.boolValue {
                return dir
            }
            dir = dir.deletingLastPathComponent()
        }
        return nil
    }

    /// The one file under `root` called `name`, or nil when there are none or more than one.
    /// Hidden folders are skipped — `.obsidian`, `.trash` and `.git` hold copies and settings, never
    /// the note a link means.
    static func uniqueMatch(named name: String, under root: URL, _ fm: FileManager) -> URL? {
        // Names are compared the way APFS compares them, so a note whose name was typed in a
        // decomposed form still answers to the link. Without both normalizations the comparison
        // is stricter than the disk it is asking about.
        let want = fold(name)
        guard let walker = fm.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey],
                                         options: [.skipsHiddenFiles, .skipsPackageDescendants]) else { return nil }
        var found: URL?
        for case let url as URL in walker where fold(url.lastPathComponent) == want {
            guard (try? url.resourceValues(forKeys: [.isRegularFileKey]))?.isRegularFile == true else { continue }
            if found != nil { return nil }          // a second one: choosing would be guessing
            found = url
        }
        return found
    }

    /// The same file, spelled the way the disk spells it. Because the lookup above is
    /// case-insensitive, `[[Sibling]]` finds sibling.md — but a URL built from the link keeps the
    /// link's spelling, and the window would then be titled with a name no file has.
    private static func asOnDisk(_ url: URL, _ fm: FileManager) -> URL {
        let parent = url.deletingLastPathComponent(), want = fold(url.lastPathComponent)
        guard let names = try? fm.contentsOfDirectory(atPath: parent.path),
              let real = names.first(where: { fold($0) == want }) else { return url }
        return parent.appendingPathComponent(real)
    }

    private static func fold(_ s: String) -> String {
        s.precomposedStringWithCanonicalMapping.lowercased()
    }

    private static func isFile(_ url: URL, _ fm: FileManager) -> Bool {
        var isDir: ObjCBool = false
        return fm.fileExists(atPath: url.path, isDirectory: &isDir) && !isDir.boolValue
    }
}
