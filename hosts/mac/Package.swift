// swift-tools-version:5.9
// marktile for macOS — a document app that opens and edits .md, and nothing else.
//
// The editor itself is NOT reimplemented here. This package is a *host*: it wraps the same
// engine the Obsidian plugin runs (editor-core.js + obsidian-shim.js) in an NSDocument + WKWebView
// shell, so the fourth surface can never drift from the other three. scripts/sync-engine.sh
// copies the engine in at build time; Sources/MarktileApp/Resources/Engine is generated and
// git-ignored, never hand-edited.
//
// Swift 5 language mode on purpose: AppKit's document/window classes predate strict Sendable
// checking, and a text editor is not where that fight pays for itself (same call andross made).
import PackageDescription

let package = Package(
    name: "MarktileMac",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "MarktileApp", targets: ["MarktileApp"]),
    ],
    // Search every document. The engine behind the `ff` command, linked in rather than run as a tool:
    // nothing to install, and it works in the App Sandbox, where a child process could not read the
    // person's files. `main`, not a version — in-house dependencies track their latest.
    dependencies: [
        .package(url: "https://github.com/CVERInc/flintfind.git", branch: "main"),
    ],
    targets: [
        .executableTarget(
            name: "MarktileApp",
            dependencies: [.product(name: "FlintfindKit", package: "flintfind")],
            path: "Sources/MarktileApp",
            resources: [
                .copy("Resources/Web"),
                .copy("Resources/Engine"),
            ]
        ),
    ]
)
