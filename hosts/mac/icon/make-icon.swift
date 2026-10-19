// marktile's app icon: Lucide `square-m` (the plugin's icon in Obsidian), drawn out of Markdown symbols.
// The frame is a mix of symbols; the M's stems are `#`, its strokes `\` and `*`, its turns `>`.
//
//   swift icon/make-icon.swift <out>.iconset && iconutil -c icns <out>.iconset
//
// Writes a macOS iconset. Sizes from 64 px up are the symbol drawing; 16 and 32 px are the plain outline,
// because at that size the symbols blur into a grey smudge.
import AppKit

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."

// --- square-m geometry, in Lucide's 24-unit space ------------------------------------------------
struct P { var x: Double; var y: Double }
let mPath = [P(x: 8, y: 16), P(x: 8, y: 8), P(x: 12, y: 12), P(x: 16, y: 8), P(x: 16, y: 16)]
let rectC = P(x: 12, y: 12), rectHalf = 9.0, rectR = 2.0

func segDist(_ p: P, _ a: P, _ b: P) -> (Double, Double) {   // distance, t
    let dx = b.x - a.x, dy = b.y - a.y
    let t = max(0, min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)))
    let qx = a.x + t * dx - p.x, qy = a.y + t * dy - p.y
    return ((qx * qx + qy * qy).squareRoot(), t)
}
func frameDist(_ p: P) -> Double {   // |signed distance| to the rounded square's outline
    let qx = abs(p.x - rectC.x) - (rectHalf - rectR), qy = abs(p.y - rectC.y) - (rectHalf - rectR)
    let ox = max(qx, 0), oy = max(qy, 0)
    return abs((ox * ox + oy * oy).squareRoot() + min(max(qx, qy), 0) - rectR)
}
enum Part { case frameH, frameV, corner, mStem, mDown, mUp, mJoint }
func classify(_ p: P, half: Double) -> Part? {
    var best: (Double, Part)? = nil
    let fd = frameDist(p)
    if fd <= half {
        let ax = abs(p.x - rectC.x), ay = abs(p.y - rectC.y)
        let part: Part = (ax > rectHalf - rectR - 0.3 && ay > rectHalf - rectR - 0.3) ? .corner : (ay > ax ? .frameH : .frameV)
        best = (fd, part)
    }
    for i in 0..<(mPath.count - 1) {
        let (d, t) = segDist(p, mPath[i], mPath[i + 1])
        guard d <= half, best == nil || d < best!.0 else { continue }
        var part: Part = [Part.mStem, .mDown, .mUp, .mStem][i]
        let joint = (i == 0 && t > 0.88) || (i == 1 && t < 0.12) || (i == 2 && t > 0.88) || (i == 3 && t < 0.12) || (i == 1 && t > 0.9) || (i == 2 && t < 0.1)
        if joint { part = .mJoint }
        best = (d, part)
    }
    return best?.1
}

// --- variants ------------------------------------------------------------------------------------
struct Variant {
    let name: String
    let cells: Int          // grid cells across the Lucide 24-unit box (frame pass)
    let half: Double        // stroke half-width, Lucide units (Lucide itself is 1.0)
    var mCells: Int = 0
    var mHalf: Double = 0
    let bg: NSColor, frame: NSColor, m: NSColor
    let glyph: (Part, Int, Int) -> String
}
func hex(_ v: UInt32) -> NSColor {
    NSColor(srgbRed: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: 1)
}
let mixed = Array("#*>-_`|[]~+=!")
func pick(_ s: [Character], _ x: Int, _ y: Int) -> String { String(s[(x * 7 + y * 13 + x * y) % s.count]) }
let byRole: (Part, Int, Int) -> String = { part, x, y in
    switch part {
    case .frameH: return "-"
    case .frameV: return "|"
    case .corner: return "#"
    case .mStem: return "#"
    case .mDown: return "\\"
    case .mUp: return "*"
    case .mJoint: return ">"
    }
}
let frameMixed: (Part, Int, Int) -> String = { p, x, y in
    (p == .frameH || p == .frameV || p == .corner) ? pick(mixed, x, y) : byRole(p, x, y)
}
let ink = hex(0x1C1C1E), frameGray = hex(0x8E8A82)
let marktile = Variant(name: "marktile", cells: 34, half: 1.35, mCells: 30, mHalf: 1.25,
                       bg: ink, frame: frameGray, m: hex(0xF2EEE6), glyph: frameMixed)

// --- render --------------------------------------------------------------------------------------
let S = 1024.0, body = 824.0, inset = (S - body) / 2, bodyR = 185.0
func render(_ v: Variant, size: Double = S) -> NSBitmapImageRep {
    let px = Int(size)
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4,
                               hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let k = size / S
    let ctx = NSGraphicsContext.current!.cgContext
    ctx.scaleBy(x: k, y: k)
    v.bg.setFill()
    NSBezierPath(roundedRect: NSRect(x: inset, y: inset, width: body, height: body), xRadius: bodyR, yRadius: bodyR).fill()
    // the Lucide box (24 units) fills ~84% of the body
    let box = body * 0.84, origin = (S - box) / 2
    for pass in 0..<2 {
        let n = pass == 0 ? v.cells : (v.mCells > 0 ? v.mCells : v.cells)
        let half = pass == 0 ? v.half : (v.mHalf > 0 ? v.mHalf : v.half)
        let cell = box / Double(n)
        let font = NSFont.monospacedSystemFont(ofSize: cell * 1.18, weight: .bold)
        for gy in 0..<n {
            for gx in 0..<n {
                let p = P(x: (Double(gx) + 0.5) / Double(n) * 24, y: (Double(gy) + 0.5) / Double(n) * 24)
                guard let part = classify(p, half: half) else { continue }
                let isFrame = part == .frameH || part == .frameV || part == .corner
                guard isFrame == (pass == 0) else { continue }
                let g = v.glyph(part, gx, gy) as NSString
                let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: isFrame ? v.frame : v.m]
                let sz = g.size(withAttributes: attrs)
                let cx = origin + (Double(gx) + 0.5) * cell, cy = S - (origin + (Double(gy) + 0.5) * cell)
                g.draw(at: NSPoint(x: cx - sz.width / 2, y: cy - sz.height / 2), withAttributes: attrs)
            }
        }
    }
    NSGraphicsContext.restoreGraphicsState()
    return rep
}
func save(_ rep: NSBitmapImageRep, _ path: String) {
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
}

// Below 64 px the symbols merge into noise, so those sizes get the plain Lucide outline instead:
// same colours, same geometry, drawn as strokes.
func renderPlain(_ v: Variant, size: Double) -> NSBitmapImageRep {
    let px = Int(size)
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4,
                               hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let k = size / S
    NSGraphicsContext.current!.cgContext.scaleBy(x: k, y: k)
    v.bg.setFill()
    NSBezierPath(roundedRect: NSRect(x: inset, y: inset, width: body, height: body), xRadius: bodyR, yRadius: bodyR).fill()
    let box = body * 0.84, origin = (S - box) / 2, u = box / 24
    func pt(_ x: Double, _ y: Double) -> NSPoint { NSPoint(x: origin + x * u, y: S - (origin + y * u)) }
    let width = 2.6 * u   // Lucide's 2-unit stroke, thickened so it survives 16 px
    let frame = NSBezierPath(roundedRect: NSRect(x: origin + 3 * u, y: S - origin - 21 * u, width: 18 * u, height: 18 * u),
                             xRadius: 2 * u, yRadius: 2 * u)
    frame.lineWidth = width; v.frame.setStroke(); frame.stroke()
    let m = NSBezierPath()
    m.move(to: pt(8, 16)); m.line(to: pt(8, 8)); m.line(to: pt(12, 12)); m.line(to: pt(16, 8)); m.line(to: pt(16, 16))
    m.lineWidth = width; m.lineCapStyle = .round; m.lineJoinStyle = .round; v.m.setStroke(); m.stroke()
    NSGraphicsContext.restoreGraphicsState()
    return rep
}

// macOS iconset: name -> pixel size
let sizes: [(String, Double)] = [
    ("icon_16x16", 16), ("icon_16x16@2x", 32), ("icon_32x32", 32), ("icon_32x32@2x", 64),
    ("icon_128x128", 128), ("icon_128x128@2x", 256), ("icon_256x256", 256), ("icon_256x256@2x", 512),
    ("icon_512x512", 512), ("icon_512x512@2x", 1024),
]
let full = render(marktile)
let fullImage = NSImage(size: NSSize(width: S, height: S)); fullImage.addRepresentation(full)
try? FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)
for (name, px) in sizes {
    let rep: NSBitmapImageRep
    if px < 64 {
        rep = renderPlain(marktile, size: px)
    } else if px == S {
        rep = full
    } else {
        // downscale the 1024 master rather than re-laying the grid, so every size is the same picture
        rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(px), pixelsHigh: Int(px), bitsPerSample: 8,
                               samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                               bytesPerRow: 0, bitsPerPixel: 0)!
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        NSGraphicsContext.current!.imageInterpolation = .high
        fullImage.draw(in: NSRect(x: 0, y: 0, width: px, height: px))
        NSGraphicsContext.restoreGraphicsState()
    }
    save(rep, "\(out)/\(name).png")
}
print("ok")
