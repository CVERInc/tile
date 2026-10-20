import FlintfindKit
import Foundation

// Search every document: this app's door onto flintfind's engine (FlintfindKit, the library behind
// the `ff` command). The engine decides what matches; this file decides only the shape the page
// reads, which is the shape `ff --json` prints — JSON is a rendering, so each door keeps its own copy.
//
// No scope is passed anywhere. Outside the sandbox the engine covers the home folder; inside it,
// Spotlight answers a sandboxed process with only the documents it may read, and the walk of the
// folders Spotlight never indexes can only open what was granted. So the folders the person allowed
// ARE the scope, and FolderAccess is the one place that decides them.
enum DocumentSearch {

    private struct Answer: Encodable {
        let query: [String], files: Int, unindexed: Int, skipped: Int
        let offline: [String], hits: [Hit], partial: Bool
    }

    /// Calls `emit` twice: the indexed half in well under a second, then the whole answer once the
    /// unindexed folders have been read (~4s over 11,500 files). Waiting for both before showing
    /// anything is what would make the panel feel broken. Blocking — call it off the main thread.
    static func run(_ terms: [String], emit: (String) -> Void) {
        let indexed = Search.spotlight(terms)
        emit(render(terms, indexed, unindexed: 0, partial: true))
        let blind = Search.blindSpot(terms, home: FolderAccess.realHome.path)
        var seen = Set<String>()
        let all = (indexed + blind).filter { seen.insert($0).inserted }
        emit(render(terms, all, unindexed: blind.count, partial: false))
    }

    private static func render(_ terms: [String], _ paths: [String], unindexed: Int, partial: Bool) -> String {
        let r = Rank.passages(paths, terms: terms)
        let answer = Answer(query: terms, files: paths.count, unindexed: unindexed, skipped: r.skipped,
                            offline: r.offline, hits: r.hits, partial: partial)
        return (try? JSONEncoder().encode(answer)).flatMap { String(data: $0, encoding: .utf8) } ?? "null"
    }

    /// `--search <terms…>`: the same search, printed, no window — with the saved folder grants resolved
    /// first, exactly as at launch. So what the App Store build can find after a grant is checkable
    /// over ssh, from the shipped binary, by the code path the panel uses.
    static func runHeadless(_ terms: [String]) -> Int32 {
        guard !terms.isEmpty else { print("usage: MarktileApp --search <term> [term…]"); return 2 }
        FolderAccess.shared.restore()
        run(terms) { print($0) }
        return 0
    }
}
