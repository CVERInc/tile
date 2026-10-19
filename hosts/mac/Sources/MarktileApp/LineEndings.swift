// The line endings a file had on disk, kept per line so a save can put each one back.
//
// The editor only ever sees LF. Most files use one ending throughout, and for them this is a plain
// swap. A file that mixes CRLF and LF (a patch applied on Windows, two people's editors) used to
// come back as all-CRLF the moment it was saved — every LF line rewritten, a diff full of changes
// nobody made. So for a mixed file, the saved text is lined up against the lines we read (a line
// diff), and every line that is still there keeps its own ending. A line that was edited takes the
// ending of the line it replaced; a line that is new takes whichever ending the file uses more.
struct LineEndings {
    /// The text with every CRLF turned into LF — what the editor gets.
    let lfText: String

    private let lines: [Substring]   // lfText split on "\n"; the last element has no ending
    private let crlf: [Bool]         // one per "\n" in lfText: did that line end in CRLF on disk
    private let majority: Bool       // the ending new lines get: true = CRLF

    /// Changed lines (old + new) above which the middle is paired by position, not diffed.
    /// The diff's worst case is this squared — about 16 million steps, well under a second.
    static let diffLimit = 4_000

    init(disk raw: String) {
        self.init(lf: raw.replacingOccurrences(of: "\r\n", with: "\n"), raw: raw)
    }

    init(lf: String) {
        self.init(lf: lf, raw: lf)
    }

    private init(lf: String, raw: String) {
        lfText = lf
        lines = lf.split(separator: "\n", omittingEmptySubsequences: false)
        var flags: [Bool] = []
        flags.reserveCapacity(lines.count)
        for ch in raw {
            // "\r\n" is a single Character in Swift, so a CRLF arrives as one grapheme.
            if ch == "\r\n" { flags.append(true) } else if ch == "\n" { flags.append(false) }
        }
        crlf = flags
        let crlfCount = flags.lazy.filter { $0 }.count
        majority = crlfCount * 2 > flags.count
    }

    /// `text` (in LF) with each line's ending put back.
    func restore(_ text: String) -> String {
        if !crlf.contains(true) { return text }
        if !crlf.contains(false) { return text.replacingOccurrences(of: "\n", with: "\r\n") }

        let new = text.split(separator: "\n", omittingEmptySubsequences: false)

        // Only the changed middle is diffed. Lines shared at the start and end are matched in a
        // single pass; a full line diff costs time proportional to lines × changes, which for a
        // 200,000-line file with many edits never finishes.
        var head = 0
        while head < lines.count, head < new.count, lines[head] == new[head] { head += 1 }
        var tail = 0
        while tail < lines.count - head, tail < new.count - head,
              lines[lines.count - 1 - tail] == new[new.count - 1 - tail] { tail += 1 }
        let oldMid = lines[head ..< lines.count - tail]
        let newMid = new[head ..< new.count - tail]

        var removed = Set<Int>(), inserted = Set<Int>()
        if oldMid.count + newMid.count <= Self.diffLimit {
            for change in newMid.difference(from: oldMid) {
                switch change {
                case .remove(let offset, _, _): removed.insert(head + offset)
                case .insert(let offset, _, _): inserted.insert(head + offset)
                }
            }
        } else {
            // Too much changed to line up cheaply: pair the middle up by position instead, which
            // is right for edits within lines and only approximate where lines were added.
            removed = Set(oldMid.indices)
            inserted = Set(newMid.indices)
        }

        func ending(ofOld i: Int?) -> Bool {
            guard let i, i < crlf.count else { return majority }
            return crlf[i]
        }

        var out = ""
        out.reserveCapacity(text.utf8.count + new.count)
        var old = 0
        var replaced: [Int] = []   // old lines removed in the current change, oldest first
        var nextReplaced = 0       // how many of them an inserted line has already taken
        for (n, line) in new.enumerated() {
            out += line
            guard n < new.count - 1 else { break }   // the last line has no ending of its own
            let isCRLF: Bool
            if inserted.contains(n) {
                while old < lines.count, removed.contains(old) { replaced.append(old); old += 1 }
                let source = nextReplaced < replaced.count ? replaced[nextReplaced] : nil
                nextReplaced += 1
                isCRLF = ending(ofOld: source)
            } else {
                while old < lines.count, removed.contains(old) { old += 1 }
                replaced.removeAll(keepingCapacity: true)
                nextReplaced = 0
                isCRLF = ending(ofOld: old)
                old += 1
            }
            out += isCRLF ? "\r\n" : "\n"
        }
        return out
    }
}
