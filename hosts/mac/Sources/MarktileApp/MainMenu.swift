import AppKit

// The menu bar, built by hand because there is no NIB.
//
// The Edit menu is not decoration: the editor is a contenteditable inside WKWebView, and
// ⌘Z/⌘X/⌘C/⌘V/⌘A only work because these selectors travel down the responder chain into the
// web view. Drop this menu and the app looks fine and silently loses copy-paste.
//
// Titles go through L() (Localization.swift). Standard items read exactly as macOS itself says them in
// each language; the editor's own concepts (modes, wikilink, inline code) use the engine's wording, so
// a mode has one name whether you meet it in the menu bar or in the editor.
func makeMainMenu() -> NSMenu {
    let appName = "marktile"
    let main = NSMenu()

    // ── App ────────────────────────────────────────────────────────────────────
    let appItem = NSMenuItem()
    main.addItem(appItem)
    let appMenu = NSMenu()
    appItem.submenu = appMenu
    appMenu.addItem(withTitle: L("About %@", appName), action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: L("Hide %@", appName), action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
    let hideOthers = appMenu.addItem(withTitle: L("Hide Others"), action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
    hideOthers.keyEquivalentModifierMask = [.command, .option]
    appMenu.addItem(withTitle: L("Show All"), action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: L("Quit %@", appName), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

    // ── File ───────────────────────────────────────────────────────────────────
    let fileItem = NSMenuItem()
    main.addItem(fileItem)
    let fileMenu = NSMenu(title: L("File"))
    fileItem.submenu = fileMenu
    fileMenu.addItem(withTitle: L("New"), action: #selector(NSDocumentController.newDocument(_:)), keyEquivalent: "n")
    fileMenu.addItem(withTitle: L("Open…"), action: #selector(NSDocumentController.openDocument(_:)), keyEquivalent: "o")
    let recents = NSMenuItem(title: L("Open Recent"), action: nil, keyEquivalent: "")
    let recentsMenu = NSMenu(title: L("Open Recent"))
    // AppKit fills and prunes this menu itself once it is tagged with this identifier.
    recentsMenu.identifier = NSUserInterfaceItemIdentifier("NSRecentDocumentsMenu")
    recents.submenu = recentsMenu
    fileMenu.addItem(recents)
    fileMenu.addItem(.separator())
    fileMenu.addItem(withTitle: L("Close"), action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
    fileMenu.addItem(withTitle: L("Save"), action: #selector(NSDocument.save(_:)), keyEquivalent: "s")
    let saveAs = fileMenu.addItem(withTitle: L("Save As…"), action: #selector(NSDocument.saveAs(_:)), keyEquivalent: "S")
    saveAs.keyEquivalentModifierMask = [.command, .shift]
    fileMenu.addItem(withTitle: L("Revert to Saved"), action: #selector(NSDocument.revertToSaved(_:)), keyEquivalent: "")

    // ── Edit ───────────────────────────────────────────────────────────────────
    let editItem = NSMenuItem()
    main.addItem(editItem)
    let editMenu = NSMenu(title: L("Edit"))
    editItem.submenu = editMenu
    editMenu.addItem(withTitle: L("Undo"), action: Selector(("undo:")), keyEquivalent: "z")
    let redo = editMenu.addItem(withTitle: L("Redo"), action: Selector(("redo:")), keyEquivalent: "Z")
    redo.keyEquivalentModifierMask = [.command, .shift]
    editMenu.addItem(.separator())
    editMenu.addItem(withTitle: L("Cut"), action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    editMenu.addItem(withTitle: L("Copy"), action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    editMenu.addItem(withTitle: L("Paste"), action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    let pastePlain = editMenu.addItem(
        title: L("Paste and Match Style"),
        action: Selector(("pasteAsPlainText:")),
        keyEquivalent: "V"
    )
    pastePlain.keyEquivalentModifierMask = [.command, .option, .shift]
    editMenu.addItem(withTitle: L("Select All"), action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    editMenu.addItem(.separator())
    // ⌘F is a reflex, and until now it landed on nothing — the find bar had exactly one door, the
    // magnifier at the far left of the toolbar.
    editMenu.addItem(withTitle: L("Find…"), action: #selector(EditorViewController.showFind(_:)), keyEquivalent: "f")

    // ── Format ─────────────────────────────────────────────────────────────────
    // Eleven of this editor's sixteen buttons had no keyboard route and no menu entry at all: the
    // toolbar was their only door, which is why it could not afford to shed a single button when the
    // window got narrow. A menu is not the "invisible room" an overflow popover would be — it is
    // always in the same place, it can be browsed, and Help's ⌘⇧/ search finds any item in it by name.
    //
    // The shortcuts follow what a Mac person already has in their fingers from Notes, Pages and every
    // word processor since: ⌘B/⌘I, ⇧⌘X for strikethrough, ⇧⌘7/⇧⌘8 for the two lists, ⇧⌘L for a
    // checklist, ⌘K for a link. Nothing invented where a convention exists.
    let formatItem = NSMenuItem()
    main.addItem(formatItem)
    let formatMenu = NSMenu(title: L("Format"))
    formatItem.submenu = formatMenu
    // (title, engine tool key, key equivalent, extra modifiers) — the key is the engine's own, so a
    // renamed tool breaks loudly at the bridge instead of quietly doing nothing.
    let tools: [(String, String, String, NSEvent.ModifierFlags)] = [
        (L("Heading 1"), "h1", "1", []),
        (L("Heading 2"), "h2", "2", []),
        (L("Heading 3"), "h3", "3", []),
        ("", "", "", []),
        (L("Bold"), "bold", "b", []),
        (L("Italic"), "italic", "i", []),
        (L("Strikethrough"), "strike", "X", [.command, .shift]),
        ("", "", "", []),
        (L("Bulleted List"), "bullet", "8", [.command, .shift]),
        (L("Numbered List"), "number", "7", [.command, .shift]),
        (L("Checklist"), "check", "L", [.command, .shift]),
        (L("Block Quote"), "quote", "'", []),
        ("", "", "", []),
        (L("Table"), "table", "", []),
        (L("Inline Code"), "code", "C", [.command, .shift]),
        (L("Wikilink"), "link", "k", []),
    ]
    for (title, key, equiv, mods) in tools {
        if title.isEmpty { formatMenu.addItem(.separator()); continue }
        let item = formatMenu.addItem(title: title,
                                      action: #selector(EditorViewController.runTool(_:)),
                                      keyEquivalent: equiv)
        if !mods.isEmpty { item.keyEquivalentModifierMask = mods }
        item.representedObject = key
    }

    // ── View ───────────────────────────────────────────────────────────────────
    // The three modes are the product. They live on a toolbar button inside the editor; these are
    // the keyboard paths to the same rig, routed through the first responder like everything else.
    let viewItem = NSMenuItem()
    main.addItem(viewItem)
    let viewMenu = NSMenu(title: L("View"))
    viewItem.submenu = viewMenu
    viewMenu.addItem(withTitle: L("Next Mode (Seasoned / Rendered / Plain)"),
                     action: #selector(EditorViewController.cycleMode(_:)), keyEquivalent: "e")
    viewMenu.addItem(withTitle: L("Table of Contents"),
                     action: #selector(EditorViewController.toggleToc(_:)), keyEquivalent: "t")
    viewMenu.addItem(.separator())
    // ⌥⌘T is macOS's own Show/Hide Toolbar shortcut — the title flips in validateMenuItem.
    // Safe to hide here in a way it would not be elsewhere: in a markdown editor the syntax is the
    // input method, so the toolbar is a convenience over `**bold**`, not the only way to reach it.
    let toolbarItem = viewMenu.addItem(title: L("Hide Toolbar"),
                                       action: #selector(EditorViewController.toggleToolbar(_:)),
                                       keyEquivalent: "t")
    toolbarItem.keyEquivalentModifierMask = [.command, .option]
    viewMenu.addItem(.separator())
    // Text size. This scales the TEXT, not the view: a WKWebView page zoom would take the toolbar
    // and the chrome with it, and the toolbar already has to fold at narrow widths — magnifying it
    // would stage that problem again on a wide window. A text editor's ⌘+ makes the text bigger.
    viewMenu.addItem(withTitle: L("Bigger Text"),
                     action: #selector(EditorViewController.textSizeUp(_:)), keyEquivalent: "+")
    // ⌘= as well, unmarked: `+` is a shifted key on most layouts, so the shortcut a person actually
    // presses is ⌘= about as often as ⌘⇧=. Every Mac text app accepts both; only one is advertised.
    let zoomInAlt = viewMenu.addItem(title: L("Bigger Text"),
                                     action: #selector(EditorViewController.textSizeUp(_:)),
                                     keyEquivalent: "=")
    zoomInAlt.isAlternate = false
    zoomInAlt.isHidden = true
    viewMenu.addItem(withTitle: L("Smaller Text"),
                     action: #selector(EditorViewController.textSizeDown(_:)), keyEquivalent: "-")
    viewMenu.addItem(withTitle: L("Actual Size"),
                     action: #selector(EditorViewController.textSizeReset(_:)), keyEquivalent: "0")
    viewMenu.addItem(.separator())
    // The other half of the head layer. Read-only is a real capability in this family, not a nicety:
    // it is what lets you scroll a document without a stray keystroke editing it.
    viewMenu.addItem(withTitle: L("Lock Editor (Read-Only)"),
                     action: #selector(EditorViewController.toggleLock(_:)), keyEquivalent: "l")

    // ── Window ─────────────────────────────────────────────────────────────────
    let windowItem = NSMenuItem()
    main.addItem(windowItem)
    let windowMenu = NSMenu(title: L("Window"))
    windowItem.submenu = windowMenu
    windowMenu.addItem(withTitle: L("Minimize"), action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
    windowMenu.addItem(withTitle: L("Zoom"), action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
    windowMenu.addItem(.separator())
    windowMenu.addItem(withTitle: L("Bring All to Front"), action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: "")
    NSApp.windowsMenu = windowMenu

    return main
}

private extension NSMenu {
    @discardableResult
    func addItem(title: String, action: Selector, keyEquivalent: String) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: keyEquivalent)
        addItem(item)
        return item
    }
}
