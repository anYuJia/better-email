// Isolated system WebKit harness. It deliberately does not link or start Tauri.
import AppKit
import WebKit

final class PerformanceApp: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    var window: NSWindow!
    var webView: WKWebView!
    var finished = false
    let url: URL
    let probe: String
    let output: String

    init(url: URL, probe: String, output: String) {
        self.url = url; self.probe = probe; self.output = output
    }

    func finish(_ result: [String: Any], success: Bool) {
        guard !finished else { return }
        finished = true
        var enriched = result
        enriched["nativeHost"] = ["os": ProcessInfo.processInfo.operatingSystemVersionString,
                                  "dataStore": "nonPersistent", "externalHTTPBlocked": true,
                                  "tauriRuntime": false, "applicationActive": NSApp.isActive,
                                  "windowVisible": window?.isVisible ?? false,
                                  "windowOcclusionVisible": window?.occlusionState.contains(.visible) ?? false,
                                  "screenMaximumFramesPerSecond": window?.screen?.maximumFramesPerSecond ?? 0,
                                  "screenBackingScaleFactor": window?.screen?.backingScaleFactor ?? 0,
                                  "webKitVersion": Bundle(identifier: "com.apple.WebKit")?.infoDictionary?["CFBundleVersion"] as? String ?? "unknown"]
        do {
            let data = try JSONSerialization.data(withJSONObject: enriched, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: URL(fileURLWithPath: output), options: .atomic)
        } catch { fputs("Could not write result: \(error)\n", stderr) }
        print(success ? "NATIVE_PERF_COMPLETE" : "NATIVE_PERF_FAILED")
        fflush(stdout)
        // Capture only after all sampling is over; rendering evidence must not
        // introduce screenshot overhead into the measurements themselves.
        webView.takeSnapshot(with: nil) { image, _ in
            if let data = image?.tiffRepresentation, let bitmap = NSBitmapImageRep(data: data),
               let png = bitmap.representation(using: .png, properties: [:]) {
                try? png.write(to: URL(fileURLWithPath: self.output + ".png"))
            }
            NSApp.terminate(nil)
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.add(self, name: "performanceProbe")
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 800), configuration: configuration)
        webView.navigationDelegate = self
        window = NSWindow(contentRect: webView.frame, styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.title = "Better Email — isolated WebKit performance probe"
        window.contentView = webView
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        let localPattern = "^http://127\\.0\\.0\\.1:\(url.port!)/"
        let rules: [[String: Any]] = [
            ["trigger": ["url-filter": "^https?://"], "action": ["type": "block"]],
            ["trigger": ["url-filter": localPattern], "action": ["type": "ignore-previous-rules"]]
        ]
        let encoded = String(data: try! JSONSerialization.data(withJSONObject: rules), encoding: .utf8)!
        // Store content-rule metadata only under the disposable harness folder.
        let rulesDirectory = URL(fileURLWithPath: output).deletingLastPathComponent().appendingPathComponent("webkit-rules")
        try? FileManager.default.createDirectory(at: rulesDirectory, withIntermediateDirectories: true)
        WKContentRuleListStore(url: rulesDirectory)!.compileContentRuleList(forIdentifier: "local-only", encodedContentRuleList: encoded) { rules, error in
            guard let rules = rules else { self.finish(["error": String(describing: error)], success: false); return }
            configuration.userContentController.add(rules)
            self.webView.load(URLRequest(url: self.url))
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 240) { self.finish(["error": "Harness timeout after 240s"], success: false) }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let target = navigationAction.request.url else { decisionHandler(.cancel); return }
        decisionHandler((target.host == url.host && target.port == url.port && target.scheme == "http") || target.absoluteString == "about:blank" ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.evaluateJavaScript(probe) { _, error in
            if let error = error { self.finish(["error": "Probe injection: \(error)"], success: false) }
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        if type == "result", let result = body["result"] as? [String: Any] { finish(result, success: true); return }
        if type == "error" { finish(["error": body["error"] ?? "Unknown page error"], success: false); return }
        if type == "progress" { print("[native-perf] \(body["name"] ?? "")"); fflush(stdout); return }
        guard type == "action", let id = body["id"] as? Int, let action = body["action"] as? [String: Any],
              let actionType = action["type"] as? String, let x = action["x"] as? Double, let y = action["y"] as? Double else { return }
        let eventType: NSEvent.EventType = actionType == "down" ? .leftMouseDown : actionType == "up" ? .leftMouseUp : .leftMouseDragged
        let point = webView.convert(NSPoint(x: x, y: webView.isFlipped ? y : webView.bounds.height - y), to: nil)
        if let event = NSEvent.mouseEvent(with: eventType, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                         windowNumber: window.windowNumber, context: nil, eventNumber: id, clickCount: 1, pressure: actionType == "up" ? 0 : 1) {
            window.sendEvent(event)
        }
        webView.evaluateJavaScript("window.__perfResolve(\(id))", completionHandler: nil)
    }
}

guard CommandLine.arguments.count == 4, let url = URL(string: CommandLine.arguments[1]),
      url.scheme == "http", url.host == "127.0.0.1", url.port != nil else {
    fatalError("Usage: native-webkit-perf LOCAL_URL PROBE_JS OUTPUT_JSON")
}
let delegate = PerformanceApp(url: url, probe: try String(contentsOfFile: CommandLine.arguments[2], encoding: .utf8), output: CommandLine.arguments[3])
let app = NSApplication.shared
app.setActivationPolicy(.regular)
app.delegate = delegate
app.run()
