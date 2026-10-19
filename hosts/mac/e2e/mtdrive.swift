// mtdrive — drives marktile.app with real keystrokes, the way a person would.
//
// Two things it deliberately does not use, both measured on the test machine (a Mac mini whose
// test account runs in a screen-shared background session):
//
//   - System Events / AppleScript. They need a separate "Automation" grant, and its prompt never
//     reached the screen: tccd logged "prompt timed out after 120 seconds" while nothing was shown.
//   - The Accessibility tree. In that session every app's AXWindows comes back as a stub whose role
//     is AXApplication (Terminal and System Settings too, not just marktile), so there is no window,
//     sheet or button to read.
//
// What does work there: keyboard events posted to the app's pid, and the window server's own list
// of windows. So the tests judge by outcome — the bytes on disk — and use window counts only to see
// that a document window or a dialog is up. Posting events needs the Accessibility grant on
// whatever process runs this (Terminal, on the test machine).
import AppKit
import ApplicationServices

let bundleID = "net.cver.marktile"

func fail(_ msg: String) -> Never {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
    exit(2)
}

func app() -> NSRunningApplication? {
    NSWorkspace.shared.runningApplications.first { $0.bundleIdentifier == bundleID && !$0.isTerminated }
}

struct Win { let width: Int; let height: Int }

/// The app's on-screen, normal-layer windows, minus the 30-pt menu-bar strips the window server
/// also lists under its pid. A document window and a sheet or alert each count as one.
func onScreenWindows() -> [Win] {
    guard let a = app(),
          let info = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]]
    else { return [] }
    return info.compactMap { w in
        guard (w[kCGWindowOwnerPID as String] as? Int32) == a.processIdentifier,
              (w[kCGWindowLayer as String] as? Int) == 0,
              let b = w[kCGWindowBounds as String] as? [String: Any],
              let width = (b["Width"] as? NSNumber)?.intValue,
              let height = (b["Height"] as? NSNumber)?.intValue,
              height > 40
        else { return nil }
        return Win(width: width, height: height)
    }
}

// MARK: - Keyboard

let keyCodes: [String: CGKeyCode] = [
    "a": 0, "s": 1, "d": 2, "z": 6, "q": 12, "w": 13, "r": 15, "n": 45,
    "return": 36, "tab": 48, "space": 49, "backspace": 51, "escape": 53,
    "left": 123, "right": 124, "down": 125, "up": 126,
]

func post(_ code: CGKeyCode, flags: CGEventFlags = [], unicode: String? = nil) {
    guard let a = app() else { fail("marktile is not running") }
    for down in [true, false] {
        guard let ev = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down) else { fail("CGEvent") }
        ev.flags = flags
        if let u = unicode {
            let s = Array(u.utf16)
            ev.keyboardSetUnicodeString(stringLength: s.count, unicodeString: s)
        }
        ev.postToPid(a.processIdentifier)
        usleep(12_000)
    }
}

func combo(_ spec: String) {
    var flags: CGEventFlags = []
    let parts = spec.lowercased().split(separator: "+").map(String.init)
    for p in parts.dropLast() {
        switch p {
        case "cmd": flags.insert(.maskCommand)
        case "shift": flags.insert(.maskShift)
        case "opt", "alt": flags.insert(.maskAlternate)
        case "ctrl": flags.insert(.maskControl)
        default: fail("unknown modifier \(p)")
        }
    }
    guard let k = parts.last, let code = keyCodes[k] else { fail("unknown key in \(spec)") }
    post(code, flags: flags)
}

// MARK: - Commands

func waitUntil(_ timeout: Double, _ cond: () -> Bool) -> Bool {
    let end = Date().addingTimeInterval(timeout)
    while Date() < end {
        if cond() { return true }
        usleep(100_000)
    }
    return cond()
}

let args = Array(CommandLine.arguments.dropFirst())
let usage = "usage: mtdrive trusted | windows | wait-windows <n> [s] | wait-gone [s] | key <combo> | type <text>"
guard let cmd = args.first else { fail(usage) }
func seconds(_ i: Int, _ def: Double) -> Double { args.count > i ? (Double(args[i]) ?? def) : def }

switch cmd {
case "trusted":
    print(AXIsProcessTrusted())
    exit(AXIsProcessTrusted() ? 0 : 1)

case "windows":
    let ws = onScreenWindows()
    print(ws.count)
    for w in ws { print("  \(w.width)x\(w.height)") }

case "wait-windows":
    // Exit 0 once exactly <n> windows are on screen; 1 on timeout.
    guard args.count >= 2, let n = Int(args[1]) else { fail("wait-windows <n> [seconds]") }
    exit(waitUntil(seconds(2, 10)) { onScreenWindows().count == n } ? 0 : 1)

case "wait-gone":
    // Ask the kernel, not NSWorkspace. `runningApplications` is refreshed by notifications that
    // only arrive on a spinning run loop, and this tool never spins one — so after the first read
    // the list is frozen, and an app that quits a moment later is reported as running forever.
    // That made a slow-but-normal ⌘Q look like a hang.
    guard let pid = app()?.processIdentifier else { exit(0) }
    exit(waitUntil(seconds(1, 10)) { kill(pid, 0) != 0 && errno == ESRCH } ? 0 : 1)

case "key":
    guard args.count >= 2 else { fail("key <combo>") }
    combo(args[1])

case "type":
    guard args.count >= 2 else { fail("type <text>") }
    for ch in args[1] { post(0, unicode: String(ch)) }

default:
    fail(usage)
}
